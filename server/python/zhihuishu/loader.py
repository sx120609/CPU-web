"""Stable frozen host for signed, externally installed assistant business code.

The desktop verifies publisher signatures and exact package bytes before passing
an immutable component directory. The host contains the pinned Python libraries.
"""
import argparse
import importlib
import json
import runpy
import sys
import types
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--component-dir')
    parser.add_argument('--check-component', action='store_true')
    parser.add_argument('--check-stdio', action='store_true')
    args = parser.parse_args()
    if args.component_dir:
        root = Path(args.component_dir).resolve(strict=True)
        worker = root / 'worker.py'
        sys.path.insert(0, str(root / 'vendor'))
        if args.check_component:
            for file in [worker, *(root / 'vendor').glob('*.py')]:
                compile(file.read_bytes(), str(file), 'exec')
            namespace = runpy.run_path(str(worker), run_name='component_probe')
            logger = types.ModuleType('logger')
            logger.logger = namespace['RedactedLogger']()
            sys.modules['logger'] = logger
            upstream = importlib.import_module('fucker')
            # Verify the frozen importer did not silently select the bundled code.
            if Path(upstream.__file__).resolve().parent != root / 'vendor':
                raise RuntimeError('External component import was shadowed')
            print(json.dumps({'type': 'component-ready', 'protocol': 1, 'runtime': 1}))
            return
        sys.argv = [str(worker)] + (['--check-stdio'] if args.check_stdio else [])
        runpy.run_path(str(worker), run_name='__main__')
    else:
        sys.argv = [sys.argv[0]] + (['--check-stdio'] if args.check_stdio else [])
        runpy.run_module('worker', run_name='__main__')


if __name__ == '__main__':
    main()
