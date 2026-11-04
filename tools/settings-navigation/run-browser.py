#!/usr/bin/env python3
"""Run the real settings-navigation fixture at each requested viewport width."""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path


class Metrics(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == 'pre' and dict(attrs).get('id') == 'metrics':
            self.active = True

    def handle_endtag(self, tag):
        if tag == 'pre' and self.active:
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def read_metrics(stdout):
    parser = Metrics()
    parser.feed(stdout)
    if not parser.parts:
        return None
    try:
        return json.loads(''.join(parser.parts))
    except json.JSONDecodeError:
        return None


def validate_metrics(metrics, width):
    if not metrics.get('ready') or not metrics.get('ok'):
        return 'fixture reported failure: ' + str(metrics.get('error', metrics))
    if metrics.get('width') != width:
        return 'fixture width mismatch: ' + repr(metrics.get('width'))
    if metrics.get('nativeRows') != 20 or metrics.get('groupedRows') != 20 or len(metrics.get('clicked', [])) != 20:
        return 'expected twenty native and grouped rows: ' + repr(metrics)
    expected = {'模型与账号': 9, '界面与显示': 4, 'Solar 与工作流': 5, '插件管理': 2}
    if metrics.get('categoryCounts') != expected:
        return 'category counts mismatch: ' + repr(metrics.get('categoryCounts'))
    required = [
        'unknownOther',
        'fiveCategoryNonOverlap',
        'localeUpdated',
        'missingRejected',
        'ambiguousRejected',
        'originalNodesPreserved',
        'originalNodesVisibleAfterCancel',
        'explicitCancel',
        'noSelect',
        'noNestedDialog',
        'noTabRoles',
        'tabrowOptionsNonOverlap',
        'inputFocusStable',
        'portalMounted',
    ]
    missing = [name for name in required if metrics.get(name) is not True]
    if missing:
        return 'required fixture assertions were false: ' + ', '.join(missing)
    return None


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:17842/')
    parser.add_argument('--output', required=True)
    parser.add_argument('--chrome', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    parser.add_argument('--timeout', type=int, default=45)
    args = parser.parse_args()

    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    runs = []
    failures = []
    for width in [1280, 980, 500]:
        profile = Path(tempfile.mkdtemp(prefix='dsh-settings-nav-chrome-'))
        stdout = ''
        stderr = ''
        metrics = None
        failure = None
        try:
            command = [
                args.chrome,
                '--headless',
                '--enable-logging=stderr',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-background-networking',
                '--disable-gpu',
                '--force-device-scale-factor=1',
                '--user-data-dir=' + str(profile),
                '--window-size=' + str(width) + ',1100',
                '--virtual-time-budget=10000',
                '--screenshot=' + str(out / (str(width) + '.png')),
                '--dump-dom',
                args.url,
            ]
            completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=args.timeout)
            stdout, stderr = completed.stdout, completed.stderr
            if completed.returncode != 0:
                failure = 'Chrome exited with code ' + str(completed.returncode)
            else:
                metrics = read_metrics(stdout)
                if metrics is None:
                    failure = 'Fixture metrics unavailable or invalid JSON'
                else:
                    failure = validate_metrics(metrics, width)
        except Exception as error:
            failure = type(error).__name__ + ': ' + str(error)
        finally:
            (out / (str(width) + '.stderr.log')).write_text(stderr, encoding='utf-8')
            if metrics is not None:
                (out / (str(width) + '.json')).write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            if failure is not None:
                (out / (str(width) + '.failure.html')).write_text(stdout, encoding='utf-8')
                (out / (str(width) + '.failure.json')).write_text(json.dumps({
                    'width': width,
                    'error': failure,
                    'metrics': metrics,
                }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
                failures.append({'width': width, 'error': failure})
                print('FAIL width=' + str(width) + ': ' + failure, file=sys.stderr, flush=True)
            else:
                runs.append(metrics)
                print(json.dumps(metrics, ensure_ascii=False), flush=True)
            shutil.rmtree(profile, ignore_errors=True)

    summary = {'ok': not failures, 'runs': runs, 'failures': failures, 'liveModels': 0}
    (out / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return 0 if not failures else 1


if __name__ == '__main__':
    raise SystemExit(run())
