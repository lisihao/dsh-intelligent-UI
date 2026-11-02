#!/usr/bin/env python3
"""Prepare source-preserving, local-only UI acceptance inputs from two official public datasets."""
import argparse
from collections import Counter
import csv
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
import gzip
import hashlib
import io
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10"
FRED_METADATA = "https://fred.stlouisfed.org/series/DGS10"
SNAP_GZIP = "https://snap.stanford.edu/data/cit-HepTh.txt.gz"
SNAP_METADATA = "https://snap.stanford.edu/data/cit-HepTh.html"
NOAA_CSV = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.csv"
NOAA_METADATA = "https://gml.noaa.gov/ccgg/trends/data.html"
NOAA_FORMAT = "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_daily_mlo.txt"
SERIES_ROWS = 10_000
GRAPH_NODES = 1000
GRAPH_EDGES = 5000
GRAPH_BYTE_LIMIT = 500 * 1024


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def write_new(path, data):
    with path.open("xb") as handle:
        handle.write(data)


def download(url, path):
    request = urllib.request.Request(url, headers={"User-Agent": "DSH-public-samples/1.0 (local UI acceptance; public official data)"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            final_url = response.geturl()
            if urllib.parse.urlparse(final_url).hostname != urllib.parse.urlparse(url).hostname:
                raise RuntimeError("Unexpected redirect outside the requested official source")
            raw = response.read()
            receipt = {"requested_url": url, "final_url": final_url, "retrieved_at_utc": datetime.now(timezone.utc).isoformat(), "http_status": response.status, "content_type": response.headers.get("Content-Type"), "etag": response.headers.get("ETag"), "last_modified": response.headers.get("Last-Modified"), "sha256": sha256(raw), "bytes": len(raw), "file": path.name}
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"SOURCE_FETCH_BLOCKED: {url}: {error}; no automatic retry performed") from error
    write_new(path, raw)
    return raw, receipt


def prepare_series(raw, output):
    reader = csv.reader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    header = next(reader)
    if len(header) != 2 or header[0] not in {"DATE", "observation_date"} or header[1] != "DGS10":
        raise ValueError(f"Unexpected FRED CSV header: {header!r}")
    records = []
    for row in reader:
        if len(row) != 2:
            raise ValueError(f"Unexpected FRED CSV record at physical line {reader.line_num}")
        date.fromisoformat(row[0])
        missing = row[1] in {"", ".", "NA"}
        if not missing:
            try:
                if not Decimal(row[1]).is_finite():
                    raise ValueError("non-finite yield")
            except (InvalidOperation, ValueError) as error:
                raise ValueError(f"Invalid yield at physical line {reader.line_num}: {row[1]!r}") from error
        records.append((row[0], row[1], missing, reader.line_num))
    if len(records) < SERIES_ROWS:
        raise ValueError(f"FRED contains only {len(records)} source records; expected at least {SERIES_ROWS}")
    selected = records[:SERIES_ROWS]
    missing_indices = [index for index, record in enumerate(selected) if record[2]]
    missing_tokens = dict(Counter(record[1] for record in selected if record[2]))
    lines = ["# FRED DGS10 · 真实公开时间序列", "", f"官方原始 CSV：{FRED_CSV}", "", f"数据说明：{FRED_METADATA}", "", f"按原始文件顺序选取前 {SERIES_ROWS} 条数据记录（不含表头），日期范围 {selected[0][0]} 至 {selected[-1][0]}。", "", "指标为美国国债 10 年期固定期限市场收益率，单位为百分比，日频、未经季节调整。", "", f"原始缺失记录共 {len(missing_indices)} 条，保持原日期并标为“未提供”；没有插值、重采样、补值、单位换算或数值舍入。其余数值逐字保留 CSV 字段字符串。", "", "这是官方数据的本地验收子集，不是全历史数据，也不提供投资判断。", "", "## 原始日期与收益率", "", "| 日期 | 收益率（%） |", "| --- | ---: |"]
    lines.extend(f"| {day} | {'未提供' if missing else value} |" for day, value, missing, _line in selected)
    lines.extend(["", "## 来源与保留范围", "", "来源：Board of Governors of the Federal Reserve System (US)，通过 Federal Reserve Bank of St. Louis 的 FRED 获取 DGS10。完整原始 CSV 和逐行溯源保存在同目录的 MANIFEST.json；仅用于本地展示验收。", ""])
    payload = "\n".join(lines).encode("utf-8")
    filename = "FRED-DGS10-first-10000.md"
    write_new(output / filename, payload)
    return {"file": filename, "bytes": len(payload), "sha256": sha256(payload), "metadata_url": FRED_METADATA, "source_record_count": len(records), "selected_record_count": len(selected), "date_range": [selected[0][0], selected[-1][0]], "missing_record_count": len(missing_indices), "missing_source_tokens": missing_tokens, "missing_source_record_indices": missing_indices, "selection_rule": "First 10000 CSV data records in original order; header excluded. No records dropped.", "field_mapping": {header[0]: "日期 (original string)", "DGS10": "收益率（%） (exact numeric source string; missing token only mapped to 未提供)"}, "source_record_index_base": 0, "source_record_indices": list(range(len(selected))), "source_physical_line_number_base": 1, "source_physical_line_numbers": [record[3] for record in selected], "transformation": "UTF-8 Markdown wrapper/table; missing values labeled 未提供. No interpolation, resampling, numeric rounding or unit conversion."}


def prepare_graph(raw_gzip, output):
    raw = gzip.decompress(raw_gzip)
    write_new(output / "cit-HepTh.original.txt", raw)
    edges, first_seen, first_occurrence = [], {}, {}
    degree = Counter()
    for line_number, line in enumerate(raw.decode("utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) != 2 or not all(part.isascii() and part.isdecimal() for part in parts):
            raise ValueError(f"Unexpected SNAP edge at physical line {line_number}: {line!r}")
        source, target = parts
        edge_index = len(edges)
        edges.append((source, target, edge_index, line_number))
        for node_id in (source, target):
            if node_id not in first_seen:
                first_seen[node_id] = None
                first_occurrence[node_id] = {"source_edge_index": edge_index, "source_physical_line_number": line_number}
            degree[node_id] += 1
    if len(first_seen) < GRAPH_NODES:
        raise ValueError("SNAP does not contain the requested number of original nodes")
    initial_nodes = list(first_seen)[:GRAPH_NODES]
    initial_set = set(initial_nodes)
    initial_edges = [edge for edge in edges if edge[0] in initial_set and edge[1] in initial_set]
    if len(initial_edges) >= GRAPH_EDGES:
        selected_ids, available = initial_nodes, initial_edges
        strategy = "First 1000 distinct original IDs encountered in edge-file order, source endpoint before target endpoint; first 5000 induced original edges in edge-file order."
    else:
        selected_ids = sorted(first_seen, key=lambda node: (-degree[node], node))[:GRAPH_NODES]
        selected_set = set(selected_ids)
        available = [edge for edge in edges if edge[0] in selected_set and edge[1] in selected_set]
        strategy = "Because the first-encountered 1000 IDs have fewer than 5000 induced edges, choose 1000 original IDs by descending in-degree plus out-degree within this downloaded dataset (ties: original ID string ascending); then take the first up to 5000 induced original directed edges in edge-file order. Capacity subset only; not paper importance, quality, or a global ranking."
    selected_edges = available[:GRAPH_EDGES]
    graph = {"nodes": [{"id": node, "label": f"论文 {node}"} for node in selected_ids], "edges": [{"source": edge[0], "target": edge[1]} for edge in selected_edges]}
    payload = json_bytes(graph)
    if len(payload) > GRAPH_BYTE_LIMIT:
        raise ValueError(f"Graph JSON is {len(payload)} bytes, above the {GRAPH_BYTE_LIMIT}-byte local import budget; no edges silently removed")
    filename = "SNAP-cit-HepTh-subset.json"
    write_new(output / filename, payload)
    selected_endpoints = {node for edge in selected_edges for node in edge[:2]}
    return {"file": filename, "bytes": len(payload), "sha256": sha256(payload), "metadata_url": SNAP_METADATA, "decompressed_source": {"file": "cit-HepTh.original.txt", "bytes": len(raw), "sha256": sha256(raw)}, "source_node_count": len(first_seen), "source_directed_edge_count": len(edges), "first_1000_encountered_induced_edge_count": len(initial_edges), "selected_node_count": len(selected_ids), "selected_directed_edge_count": len(selected_edges), "selected_node_induced_edge_count_before_first_edge_limit": len(available), "selected_nodes_touched_by_selected_edges": len(selected_endpoints), "selected_isolated_node_count": len(selected_ids) - len(selected_endpoints), "requested_1000_nodes_5000_edges_met": len(selected_ids) == GRAPH_NODES and len(selected_edges) == GRAPH_EDGES, "selection_rule": strategy, "field_mapping": {"nodes.id": "Unmodified original paper ID string", "nodes.label": "论文 + one space + original ID; display label, not an invented paper title", "edges.source": "Original source endpoint ID; citing paper", "edges.target": "Original target endpoint ID; cited paper"}, "source_edge_index_base": 0, "source_physical_line_number_base": 1, "selected_node_original_ids": selected_ids, "selected_node_first_occurrences": [first_occurrence[node] for node in selected_ids], "selected_source_edge_indices": [edge[2] for edge in selected_edges], "selected_source_physical_line_numbers": [edge[3] for edge in selected_edges], "transformation": "Deterministic node/edge subset; preserve original directed endpoints and edge order. No inferred, reversed, synthesized or aggregated edges; original IDs kept as strings."}


def prepare_noaa(raw, output):
    records = []
    for line_number, line in enumerate(raw.decode("utf-8-sig").splitlines(), 1):
        if not line or line.startswith("#"):
            continue
        row = next(csv.reader([line]))
        if len(row) != 5:
            raise ValueError(f"Unexpected NOAA column count at physical line {line_number}")
        # The actual CSV has no header; the linked official text file identifies
        # year, month, day, decimal year, CO2 molfrac (ppm). Do not guess by magnitudes.
        day = date(int(row[0]), int(row[1]), int(row[2])).isoformat()
        value = Decimal(row[4])
        if not value.is_finite():
            raise ValueError(f"Non-finite NOAA CO2 at physical line {line_number}")
        records.append((day, row[4], value < 0, line_number, row[:4]))
    if len(records) < SERIES_ROWS:
        raise ValueError(f"NOAA has only {len(records)} observations; expected at least {SERIES_ROWS}")
    selected = records[:SERIES_ROWS]
    missing_indices = [index for index, record in enumerate(selected) if record[2]]
    lines = ["# NOAA Mauna Loa · 真实公开 CO₂ 日均观测", "", f"官方原始 CSV：{NOAA_CSV}", "", f"官方数据说明：{NOAA_METADATA}", "", f"官方文本格式与单位说明：{NOAA_FORMAT}", "", f"按原始文件顺序取前 {SERIES_ROWS} 条实际提供的日均观测，日期范围 {selected[0][0]} 至 {selected[-1][0]}。", "", "单位：ppm。CSV 在注释后没有表头，五列依次为年、月、日、十进制年份、CO₂ 摩尔分数；单位由官方文本格式说明提供。日期仅由原有年月日字段组合成 ISO 格式，第五列的非缺测数值字符串逐字保留，没有换算或舍入。", "", f"所选负值缺测标记共 {len(missing_indices)} 条；若有标记，则显示为“缺测（原值-999.99）”等原始标记形式，不作为真实 CO₂ 浓度绘图。原 CSV 中缺少部分日历日期；本表不新增这些日期，不插值、重采样或补造观测。", "", f"原文件注明最近数月为初步值，并说明 2022–2023 年火山中断期间的替代站点。本子集日期范围 {selected[0][0]} 至 {selected[-1][0]}；完整来源注释保留在原 CSV。", "", "## 原始日期与 CO₂ 观测", "", "| 日期 | CO₂ 摩尔分数（ppm） |", "| --- | ---: |"]
    lines.extend(f"| {day} | {'缺测（原值' + value + '）' if missing else value} |" for day, value, missing, _line, _original in selected)
    lines.extend(["", "## 来源与保留范围", "", "来源：NOAA Global Monitoring Laboratory；引用信息见官方页面的 Xin Lan（NOAA/GML）与 Ralph Keeling（Scripps）。本表仅为本地界面验收子集，不是全时段记录。完整 CSV 与逐行索引见 MANIFEST.json。", ""])
    payload = "\n".join(lines).encode("utf-8")
    filename = "NOAA-CO2-daily-MLO-first-10000.md"
    write_new(output / filename, payload)
    return {"file": filename, "bytes": len(payload), "sha256": sha256(payload), "metadata_url": NOAA_METADATA, "format_and_unit_reference": NOAA_FORMAT, "source_header": None, "source_record_count": len(records), "selected_record_count": len(selected), "date_range": [selected[0][0], selected[-1][0]], "missing_record_count": len(missing_indices), "missing_source_tokens": dict(Counter(record[1] for record in selected if record[2])), "full_source_negative_marker_count": sum(record[2] for record in records), "missing_source_record_indices": missing_indices, "selection_rule": "First 10000 actual CSV observations in file order, excluding comment lines. Calendar gaps are not filled.", "field_mapping": {"CSV columns 1-3": "日期: ISO year-month-day assembled only from original fields", "CSV column 4": "Decimal year retained in original CSV, not plotted", "CSV column 5": "CO₂ 摩尔分数（ppm）: exact numeric string; negative missing sentinel displayed as 缺测（原值<original string>）"}, "source_record_index_base": 0, "source_record_indices": list(range(len(selected))), "source_physical_line_number_base": 1, "source_physical_line_numbers": [record[3] for record in selected], "transformation": "Comment-free observation selection, ISO date formatting from source year/month/day, UTF-8 Markdown wrapper, exact numeric source strings, explicit missing sentinels. No interpolation, unit conversion, rounding, resampling or invented dates."}


def verify_sample_citation_counts(graph_payload, markdown_payload):
    """Recompute every count and verify exact row order, zeros, total and source hash."""
    graph = json.loads(graph_payload)
    ids = [node["id"] for node in graph["nodes"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate source node IDs")
    expected = dict.fromkeys(ids, 0)
    for edge in graph["edges"]:
        if edge["source"] not in expected or edge["target"] not in expected:
            raise ValueError("Citation edge endpoint absent from original selected nodes")
        expected[edge["target"]] += 1
    markdown = markdown_payload.decode("utf-8")
    if sha256(graph_payload) not in markdown:
        raise ValueError("Derived table is missing the exact input graph hash")
    lines = [line for line in markdown.splitlines() if line.startswith("| ")]
    if lines[:2] != ["| 论文 | 样本内被引次数（次） |", "| --- | ---: |"]:
        raise ValueError("Unexpected citation-count table header")
    if len(lines) - 2 != len(ids):
        raise ValueError("Derived count row count differs from original selected node count")
    actual = []
    for node, line in zip(ids, lines[2:]):
        fields = [field.strip() for field in line.split("|")[1:-1]]
        if len(fields) != 2 or fields[0] != "论文 " + node or not fields[1].isascii() or not fields[1].isdecimal():
            raise ValueError("Citation-count source ID, row order or integer value changed")
        count = int(fields[1])
        if count != expected[node]:
            raise ValueError("Derived citation count does not match target occurrences")
        actual.append(count)
    if sum(actual) != len(graph["edges"]):
        raise ValueError("Derived citation counts do not sum to selected edge count")
    return {"all_source_nodes_recomputed_exactly": True, "verified_node_count": len(ids), "verified_count_sum": sum(actual), "expected_selected_edge_count": len(graph["edges"]), "zero_count_node_count": sum(count == 0 for count in actual), "source_node_order_preserved": True, "source_graph_sha256": sha256(graph_payload)}


def prepare_sample_citation_counts(graph_payload, output):
    graph = json.loads(graph_payload)
    counts = Counter(edge["target"] for edge in graph["edges"])
    graph_sha = sha256(graph_payload)
    lines = ["# SNAP cit-HepTh · 样本内被引次数（派生计数）", "", f"官方来源说明：{SNAP_METADATA}", "", "本表由同目录 SNAP-cit-HepTh-subset.json 的实际选取边计算，没有下载新数据。节点按该 JSON 的原始节点顺序逐个保留，不按计数排序。", "", f"输入图 SHA-256：{graph_sha}", "", f"输入子集包含 {len(graph['nodes'])} 个原始论文 ID 和 {len(graph['edges'])} 条实际有向边；每条边的 target 出现一次，就为该论文增加一次样本内被引计数，原始零计数同样保留。", "", f"这是所选 {len(graph['edges'])} 边子集内的派生计数，不是论文全局被引量、重要性、质量或排名；不能推论全网络统计。原图端点、方向与来源行号均未修改。", "", "## 样本内逐论文计数", "", "| 论文 | 样本内被引次数（次） |", "| --- | ---: |"]
    lines.extend(f"| 论文 {node['id']} | {counts[node['id']]} |" for node in graph["nodes"])
    lines.extend(["", "## 计算与溯源", "", f"计数合计应为所选原始边数 {len(graph['edges'])}。原始图、完整官方源文件及边索引在 MANIFEST.json 中；本表只增加确定性派生计数，没有编造原始引用边。", ""])
    payload = "\n".join(lines).encode("utf-8")
    if len(payload) >= GRAPH_BYTE_LIMIT:
        raise ValueError("Derived citation table exceeds the 500 KiB import budget")
    verification = verify_sample_citation_counts(graph_payload, payload)
    filename = "SNAP-cit-HepTh-sample-citation-counts.md"
    write_new(output / filename, payload)
    return {"file": filename, "bytes": len(payload), "sha256": sha256(payload), "derived": True, "source_graph_file": "SNAP-cit-HepTh-subset.json", "source_graph_sha256": graph_sha, "metadata_url": SNAP_METADATA, "selected_record_count": len(graph["nodes"]), "source_node_indices": list(range(len(graph["nodes"]))), "source_node_original_ids": [node["id"] for node in graph["nodes"]], "field_mapping": {"论文": "论文 + one space + original selected node ID; original graph node order", "样本内被引次数（次）": "Number of target occurrences in exactly this selected graph edge array, including zeros; integer derived count"}, "transformation": "Count selected directed-edge target occurrences, no sorting or filtering of nodes. This is not global citation count or ranking; original graph is unchanged.", "verification": verification}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True, help="New or empty private artifact directory; never the repository")
    parser.add_argument("--only", choices=("all", "fred", "noaa", "snap"), default="all", help="Default all prepares NOAA plus SNAP; individual sources run independently without retries")
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise FileExistsError(f"Refusing to overwrite existing artifacts: {output}")
    series = graph = fred_receipt = noaa_receipt = snap_receipt = None
    if args.only == "fred":
        fred, fred_receipt = download(FRED_CSV, output / "DGS10.original.csv")
        series = prepare_series(fred, output)
    if args.only in {"all", "noaa"}:
        noaa, noaa_receipt = download(NOAA_CSV, output / "NOAA-CO2-daily-MLO.original.csv")
        series = prepare_noaa(noaa, output)
    if args.only in {"all", "snap"}:
        snap, snap_receipt = download(SNAP_GZIP, output / "cit-HepTh.original.txt.gz")
        graph = prepare_graph(snap, output)
    citation_counts = prepare_sample_citation_counts((output / graph["file"]).read_bytes(), output) if graph is not None else None
    manifest = {"format_version": 1, "purpose": "Local installed-DSH UI acceptance using official public originals; prepared data is not a plugin distribution artifact.", "selected_sources": args.only, "prepared_at_utc": datetime.now(timezone.utc).isoformat(), "prepare_script_sha256": sha256(Path(__file__).read_bytes()), "sources": {key: value for key, value in {"fred": fred_receipt, "noaa": noaa_receipt, "snap": snap_receipt}.items() if value is not None}, "payloads": {key: value for key, value in {"time_series": series, "citation_graph": graph, "sample_citation_counts": citation_counts}.items() if value is not None}}
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False).encode("utf-8") + b"\n"
    write_new(output / "MANIFEST.json", manifest_bytes)
    readme = """# 本地真实公开数据验收样本（私有工作材料）

仅用于本机 DSH 导入与展示验收。没有模型请求；数据不是合成样例。下载的原件、转换结果和本说明不进入 Git，也不随插件发布。
"""
    if fred_receipt is not None:
        readme += f"""
## FRED DGS10

- 官方数据：{FRED_CSV}
- 官方说明：{FRED_METADATA}
- 原始 CSV：`DGS10.original.csv`；SHA-256：`{fred_receipt['sha256']}`。
- 导入文件：`{series['file']}`；{series['selected_record_count']} 条原始数据记录，{series['date_range'][0]} 至 {series['date_range'][1]}；缺失 {series['missing_record_count']} 条。
- 缺失标为“未提供”，保留其日期；未插值、重采样、舍入或单位换算。其余原始数值字符串完整保留。
- 导入文件 SHA-256：`{series['sha256']}`；UTF-8 大小：{series['bytes']} 字节。
- 来源引用：Board of Governors of the Federal Reserve System (US), DGS10, retrieved from FRED, Federal Reserve Bank of St. Louis。
"""
    else:
        readme += "\n## FRED DGS10\n\n本次独立调用未准备 FRED；没有对应时间序列载荷，不得声称其已经下载或验收。\n"
    if noaa_receipt is not None:
        readme += f"""
## NOAA Mauna Loa CO₂

- 官方数据：{NOAA_CSV}
- 官方说明：{NOAA_METADATA}；位置字段与 ppm 单位参考：{NOAA_FORMAT}。
- 实际 CSV 无表头，注释之后五列分别为年、月、日、十进制年份与 CO₂ molfrac。未假造列名来自 CSV 本身。
- 原始 CSV SHA-256：`{noaa_receipt['sha256']}`。
- 导入文件：`{series['file']}`，{series['selected_record_count']} 条实际观测，{series['date_range'][0]} 至 {series['date_range'][1]}；所选负值缺测标记 {series['missing_record_count']} 条。
- 原文件不存在的日历日期不会被新增；负值缺测标记若存在则以“缺测（原值...）”显示并保留原标记；其余 ppm 数值字符串逐字保留，不换算或舍入。
- 导入文件 SHA-256：`{series['sha256']}`；UTF-8 大小：{series['bytes']} 字节。
- 来源引用按官方页面：Xin Lan, NOAA/GML；Ralph Keeling, Scripps Institution of Oceanography。
"""
    if graph is not None:
        readme += f"""
## SNAP cit-HepTh

- 官方数据：{SNAP_GZIP}
- 官方说明：{SNAP_METADATA}
- 原始压缩文件 SHA-256：`{snap_receipt['sha256']}`；解压原件 SHA-256：`{graph['decompressed_source']['sha256']}`。
- 完整下载记录：{graph['source_node_count']} 个节点、{graph['source_directed_edge_count']} 条有向引用边；边方向为“引用者 → 被引用者”。
- 首次遇到的 1000 个原始 ID 的诱导边数：{graph['first_1000_encountered_induced_edge_count']}。
- 选取规则：{graph['selection_rule']}
- 导入文件：`{graph['file']}`；{graph['selected_node_count']} 个原始 ID、{graph['selected_directed_edge_count']} 条实际有向边；其中 {graph['selected_isolated_node_count']} 个选中 ID 未出现在截取的边中。
- 这是容量验收子集，不是完整网络，不是论文重要性、质量或全局排名；不得用此子集计算并声称全数据集统计结论。
- “论文 ID”仅为 ID 显示标签，不是论文题名。没有编造节点、引用边、时间或数值。
- 导入 JSON SHA-256：`{graph['sha256']}`；UTF-8 大小：{graph['bytes']} 字节，小于 500 KiB，便于现有发布接口同时保存原文和载荷。
- 官方页面引用：J. Leskovec, J. Kleinberg and C. Faloutsos, KDD 2005；J. Gehrke, P. Ginsparg and J. M. Kleinberg, SIGKDD Explorations 2003。
"""
    else:
        readme += "\n## SNAP cit-HepTh\n\n本次独立调用未准备 SNAP；没有对应图载荷，不得声称其已经下载或验收。\n"
    if citation_counts is not None:
        readme += f"\n## 样本内被引次数（派生计数）\n\n导入文件：`{citation_counts['file']}`，{citation_counts['selected_record_count']} 条原始顺序节点记录，{citation_counts['bytes']} 字节。SHA-256：`{citation_counts['sha256']}`。\n\n来源为所选原图 `{citation_counts['source_graph_sha256']}`；逐条重新核对全部节点的 target 出现次数，合计 {citation_counts['verification']['verified_count_sum']}，零计数节点 {citation_counts['verification']['zero_count_node_count']} 个。没有更改图或下载新源；计数只覆盖该子集，不代表全局被引量或排名。\n"
    readme += """
## 溯源与复现

`MANIFEST.json` 记录下载 UTC 时间、官方 URL、HTTP 元信息、原件与载荷哈希、字段映射、原始记录数、缺失位置、选中的原始节点 ID、数据边索引及物理行号。数据记录/边索引以 0 起算，物理行号以 1 起算；原件可用于逐条验证。

运行仓库内 `tools/public-samples/prepare.py --output <新的空私有目录>` 默认按相同规则下载和准备 NOAA 与 SNAP。`--only noaa`、`--only fred` 或 `--only snap` 可独立处理单一来源，避免重试另一个已知阻塞来源。官方原件随时间变化时以新的原件哈希为准；脚本拒绝覆盖现有材料，没有重试、模型调用或下载脚本执行。
"""
    write_new(output / "README.private.md", readme.encode("utf-8"))
    print(json.dumps({"output": str(output), "manifest_sha256": sha256(manifest_bytes), "time_series": {key: series[key] for key in ("file", "selected_record_count", "missing_record_count", "date_range", "bytes", "sha256")} if series else None, "citation_graph": {key: graph[key] for key in ("file", "first_1000_encountered_induced_edge_count", "selected_node_count", "selected_directed_edge_count", "selected_isolated_node_count", "bytes", "sha256", "requested_1000_nodes_5000_edges_met")} if graph else None}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
