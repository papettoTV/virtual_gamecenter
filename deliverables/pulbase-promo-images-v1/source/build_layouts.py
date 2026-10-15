#!/usr/bin/env python3
"""Build individually art-directed, static HTML layouts; reuse the approved opening assets."""
import json
from pathlib import Path

PACK = Path(__file__).resolve().parents[1]
ASSETS = PACK.parent / 'pulbase-C-hyperframes/cut/assets'
LAYOUTS = PACK / 'source/layouts'
SPECS = [
    dict(id='ogp',w=1200,h=630,use='OGP・リンク共有',kind='wide',photo=(600,0,600,630),box=(60,116,600),sizes=(20,100,32,34),gaps=(25,23,22,27),rule=340),
    dict(id='social-wide',w=1200,h=675,use='SNS横長投稿',kind='wide',photo=(600,0,600,675),box=(60,137,600),sizes=(20,100,32,34),gaps=(25,23,22,27),rule=340),
    dict(id='social-square',w=1080,h=1080,use='SNS正方形投稿',kind='portrait',photo=(0,0,1080,1080),box=(60,542,960),sizes=(24,144,42,48),gaps=(26,24,25,30),rule=580,pos='center 16%'),
    dict(id='social-portrait',w=1080,h=1350,use='SNS縦長投稿（4:5）',kind='portrait',photo=(0,0,1080,1350),box=(60,726,960),sizes=(27,148,43,49),gaps=(30,28,28,35),rule=600,pos='center 22%'),
    dict(id='story',w=1080,h=1920,use='ストーリー・縦長告知',kind='portrait',photo=(0,0,1080,1920),box=(54,590,972),sizes=(33,159,46.5,64.5),gaps=(45,40.5,36,52.5),rule=585,pos='center center'),
    dict(id='web-hero',w=1920,h=1080,use='サイトのメイン画像・16:9告知',kind='wide',photo=(960,0,960,1080),box=(96,230,950),sizes=(32,166,52,58),gaps=(43,40,36,48),rule=570),
    dict(id='web-banner',w=1920,h=640,use='サイト横長バナー',kind='wide',photo=(1060,0,860,640),box=(96,94,1000),sizes=(25,144,42,48),gaps=(24,26,22,26),rule=500),
    dict(id='x-header',w=1500,h=500,use='Xプロフィールヘッダー',kind='header',photo=(940,0,560,500),box=(335,53,760),sizes=(19,107,32,34),gaps=(17,19,18,22),rule=380),
    dict(id='ad-rectangle',w=300,h=250,use='レクタングル広告',kind='rectangle',photo=(0,0,300,250),box=(18,69,264),sizes=(0,43,17,20),gaps=(0,10,10,14),rule=152,copy=['すぐ遊べる。','観戦から、対戦も。'],pos='center 12%'),
    dict(id='ad-leaderboard',w=728,h=90,use='横長広告',kind='leaderboard',photo=(562,0,166,90)),
    dict(id='ad-mobile',w=320,h=100,use='モバイル広告',kind='mobile',photo=(217,0,103,100)),
]

def generate(s):
    ident=s['id']; w=s['w'];h=s['h']; k=s['kind'];x,y,pw,ph=s['photo']
    styles=f'''
@font-face{{font-family:CutJP;src:url('assets/Japanese.ttc') format('truetype');font-weight:600 900;font-display:block}}
*{{box-sizing:border-box}}html,body{{margin:0;width:100%;height:100%;background:#171322}}
body{{font-family:CutJP,sans-serif;color:#fff8ee}}
#root{{position:relative;width:100%;height:100%;overflow:hidden;background:#171322}}
.photo{{position:absolute;left:{x}px;top:{y}px;width:{pw}px;height:{ph}px;object-fit:cover;object-position:{s.get('pos','center 30%')};z-index:0}}
.scrim{{position:absolute;inset:0;z-index:1;pointer-events:none}}
.lockup{{position:absolute;z-index:2;display:flex;flex-direction:column}}
p,h1{{margin:0}}.category{{font-weight:800;line-height:1.4;letter-spacing:.14em;white-space:nowrap}}
.wordmark{{font-weight:900;line-height:1.1;letter-spacing:.025em;white-space:nowrap}}
.rule{{flex-shrink:0;background:#56deed}}.copy{{font-weight:800;line-height:1.6;white-space:nowrap}}
.url{{font-weight:800;line-height:1.3;letter-spacing:.035em;white-space:nowrap}}
'''
    photo='<img class="photo" src="assets/arcade-opening-crowded-v1.png" alt="ゲームセンターに人が集まり、ゲームを楽しんでいる風景">'
    if k in ['wide','header']:
        # A photographic half and a calm text half; a gentle seam preserves the original warm arcade light.
        start=round(x/w*100,2); end=round(min(w,x+pw*.45)/w*100,2)
        styles+=f'.scrim{{background:linear-gradient(90deg,#171322 0%,#171322 {start-3}%,rgba(23,19,34,.87) {start+4}%,rgba(23,19,34,.20) {end}%,rgba(23,19,34,.03) 100%)}}\n'
    elif k=='portrait':
        if ident=='story':
            styles+='.scrim{background:linear-gradient(180deg,rgba(23,19,34,.08) 5%,rgba(23,19,34,.22) 26%,rgba(23,19,34,.76) 36%,rgba(23,19,34,.75) 65%,rgba(23,19,34,.32) 100%)}\n'
        else:
            styles+='.scrim{background:linear-gradient(180deg,rgba(23,19,34,.02) 0%,rgba(23,19,34,.06) 30%,rgba(23,19,34,.84) 53%,rgba(23,19,34,.96) 100%)}\n'
    elif k=='rectangle':
        styles+='.scrim{background:linear-gradient(180deg,rgba(23,19,34,.13) 0%,rgba(23,19,34,.90) 28%,#171322 100%)}\n'
    if 'sizes' in s:
        left,top,bw=s['box'];cat,title,copy,url=s['sizes'];g1,g2,g3,g4=s['gaps']
        center=k in ['portrait','rectangle']
        styles+=f'''.lockup{{left:{left}px;top:{top}px;width:{bw}px;align-items:{'center' if center else 'flex-start'};text-align:{'center' if center else 'left'}}}
.category{{font-size:{cat}px;margin-bottom:{g1}px}}
.wordmark{{font-size:{title}px;{'text-shadow:0 4px 0 #171322,0 10px 35px #171322;' if k=='portrait' else ''}}}
.rule{{width:{s['rule']}px;height:{max(2,round(w/270))}px;margin:{g2}px 0 {g3}px}}
.copy{{font-size:{copy}px}}
.url{{font-size:{url}px;margin-top:{g4}px}}
'''
        if k=='portrait':styles+='.category,.copy,.url{text-shadow:0 3px 12px #171322}\n'
        copy_content=''.join(f'<p class="copy">{line}</p>' for line in s.get('copy',['すぐ遊べる。観戦から、対戦も。']))
        lock=f'''<div class="lockup">{('<p class="category">GAME CENTER ONLINE</p>' if cat else '')}<h1 class="wordmark">PULBASE</h1><div class="rule" aria-hidden="true"></div>{copy_content}<p class="url">pulbase.com</p></div>'''
    elif k=='leaderboard':
        styles+='''
.scrim{background:linear-gradient(90deg,#171322 0%,#171322 74%,rgba(23,19,34,.1) 88%)}
.wordmark{position:absolute;z-index:2;left:22px;top:24px;font-size:40px}
.rule{position:absolute;z-index:2;left:262px;top:22px;width:3px;height:46px}
.copy{position:absolute;z-index:2;left:287px;top:13px;font-size:17px}
.url{position:absolute;z-index:2;left:287px;top:48px;font-size:19px}
'''
        lock='<h1 class="wordmark">PULBASE</h1><div class="rule" aria-hidden="true"></div><p class="copy">すぐ遊べる。観戦から、対戦も。</p><p class="url">pulbase.com</p>'
    else:
        styles+='''
.scrim{background:linear-gradient(90deg,#171322 0%,#171322 65%,rgba(23,19,34,.1) 83%)}
.wordmark{position:absolute;z-index:2;left:16px;top:9px;font-size:33px}
.copy{position:absolute;z-index:2;left:16px;top:51px;font-size:13px}
.url{position:absolute;z-index:2;left:16px;top:76px;font-size:13px;color:#56deed}
'''
        lock='<h1 class="wordmark">PULBASE</h1><p class="copy">観戦から、対戦も。</p><p class="url">pulbase.com</p>'
    return f'''<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width={w},height={h}"><title>PULBASE — {s['use']}</title><script src="assets/gsap.min.js"></script><style>{styles}</style></head>
<body><div id="root" data-composition-id="{ident}" data-width="{w}" data-height="{h}" data-duration="1" data-no-timeline>{photo}<div class="scrim" aria-hidden="true"></div>{lock}</div>
<script>const tl=gsap.timeline({{paused:true}});window.__timelines=window.__timelines||{{}};window.__timelines['{ident}']=tl;</script></body></html>
'''

for s in SPECS:
    dest=LAYOUTS/s['id'];dest.mkdir(parents=True,exist_ok=True)
    link=dest/'assets'
    if not link.exists():
        import os
        link.symlink_to(os.path.relpath(ASSETS,dest),target_is_directory=True)
    (dest/'index.html').write_text(generate(s))
(PACK/'source/sizes.json').write_text(json.dumps(SPECS,ensure_ascii=False,indent=2)+'\n')
print(f'Built {len(SPECS)} static layouts in {LAYOUTS}')
