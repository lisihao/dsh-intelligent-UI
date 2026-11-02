/** Source-owned quantitative or evidentiary visuals are not decorative illustrations. */
const evidenceVisual = /(?:\b(?:chart|graph|diagram|architecture|schematic|infographic|flowchart|plot|heatmap|candlestick|screenshot|photo|photograph|evidence)\b|图表|圖表|图解|圖解|示意图|示意圖|流程图|流程圖|架构图|架構圖|拓扑图|拓撲圖|关系图|關係圖|时序图|時序圖|趋势图|趨勢圖|折线图|折線圖|柱状图|柱狀圖|柱形图|柱形圖|饼图|餅圖|散点图|散點圖|热力图|熱力圖|[kＫｋ]\s*线图|[kＫｋ]\s*線圖|蜡烛图|蠟燭圖|截图|截圖|照片|证据|證據)/iu

export function isEvidenceVisualLabel(value: string): boolean { return evidenceVisual.test(value) }
