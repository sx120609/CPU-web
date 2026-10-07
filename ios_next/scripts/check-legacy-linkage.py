#!/usr/bin/env python3
"""Verify the built iPhone app can load without ActivityKit (iOS 15).

Checks both the app and embedded widget binary. Passing does not replace
actual launch tests on supported OS versions.
"""
import argparse
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('app', type=Path)
args = parser.parse_args()
for bundle in [args.app, *args.app.glob('PlugIns/*.appex')]:
    info = plistlib.loads((bundle / 'Info.plist').read_bytes())
    if bundle == args.app and info.get('MinimumOSVersion') != '15.0':
        raise SystemExit(f'Unexpected minimum OS: {info.get("MinimumOSVersion")}')
    if bundle == args.app:
        # iOS terminates the app when it reaches one of these without its
        # purpose string: the web file picker's camera, video recording, and
        # the share sheet's Save Image.
        for key in ['NSCalendarsUsageDescription', 'NSCalendarsFullAccessUsageDescription',
                    'NSCameraUsageDescription', 'NSMicrophoneUsageDescription',
                    'NSPhotoLibraryAddUsageDescription']:
            if not info.get(key, '').strip():
                raise SystemExit(f'Missing purpose string: {key}')
    if bundle == args.app:
        # BGTaskScheduler refuses an app-refresh request, with an error the app
        # can only swallow, unless the app declares the fetch background mode.
        if 'fetch' not in info.get('UIBackgroundModes', []):
            raise SystemExit('Missing UIBackgroundModes fetch for the Live Activity refresh task')
    binary = bundle / info['CFBundleExecutable']
    # Archives may strip undefined entries from the symbol table; dyld's
    # import table is the authoritative source for runtime weak imports.
    symbols = subprocess.check_output(['xcrun', 'dyld_info', '-imports', str(binary)], text=True)
    references = [line for line in symbols.splitlines() if '(from ActivityKit)' in line]
    if not references:
        raise SystemExit(f'No ActivityKit imports found in {binary}; inspect the build before accepting it')
    strong = [line for line in references if '[weak-import]' not in line]
    if strong:
        raise SystemExit(f'Strong ActivityKit imports in {binary}:\n' + '\n'.join(strong))
    commands = subprocess.check_output(['xcrun', 'otool', '-l', str(binary)], text=True)
    loads = [part for part in commands.split('Load command ') if '/ActivityKit.framework/ActivityKit' in part]
    if not loads or any('LC_LOAD_WEAK_DYLIB' not in part for part in loads):
        raise SystemExit(f'ActivityKit must be an optional framework in {binary}')
    print(f'{bundle.name}: {len(references)} ActivityKit imports are weak; framework is optional')
