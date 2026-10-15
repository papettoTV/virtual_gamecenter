#!/usr/bin/env python3
"""Check each static layout, capture its PNG, and encode portable image variants.
Requires HyperFrames 0.8.162 (Node 22+) and Pillow. No video is rendered.
"""
import argparse, concurrent.futures, json, shutil, subprocess, tempfile
from pathlib import Path
from PIL import Image

PACK=Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cli',help='Path to hyperframes.mjs; otherwise use npx hyperframes@0.8.162')
    parser.add_argument('--skip-check',action='store_true',help='Use only immediately after a passing full check')
    parser.add_argument('--only',nargs='*')
    args=parser.parse_args()
    specs=json.loads((PACK/'source/sizes.json').read_text())
    if args.only: specs=[s for s in specs if s['id'] in args.only]
    cli=['node',args.cli] if args.cli else ['npx','hyperframes@0.8.162']
    for fmt in ['png','jpg','webp']:(PACK/fmt).mkdir(exist_ok=True)
    def export(s):
        project=PACK/'source/layouts'/s['id']
        if not args.skip_check:
            subprocess.run(cli+['check',str(project),'--strict'],check=True,capture_output=True,text=True)
        with tempfile.TemporaryDirectory(prefix='pulbase-image-') as temp:
            result=subprocess.run(cli+['snapshot',str(project),'--at','0','--no-end','--describe','false','--output',temp],check=True,capture_output=True,text=True)
            src=Path(temp)/'frame-00-at-0s.png'
            stem=f"pulbase-{s['id']}-{s['w']}x{s['h']}"
            image=Image.open(src).convert('RGB')
            assert image.size==(s['w'],s['h']), (s['id'],image.size)
            image.save(PACK/'png'/f'{stem}.png',optimize=True)
            image.save(PACK/'jpg'/f'{stem}.jpg',quality=92,subsampling=0,optimize=True)
            if s['id'] in ['ogp','web-hero','web-banner','ad-rectangle','ad-leaderboard','ad-mobile']:
                image.save(PACK/'webp'/f'{stem}.webp',quality=90,method=6)
            print(f"Exported {s['id']} {s['w']}x{s['h']}",flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(export,specs))

if __name__=='__main__':main()
