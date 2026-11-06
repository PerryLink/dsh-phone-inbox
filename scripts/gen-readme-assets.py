#!/usr/bin/env python3
"""README visuals for dsh-phone-inbox — derived from the plugin's real pipeline.

Two figures, both read off the shipped code rather than a generic template:

  hero 1440×576 (Pillow, 4 files: zh/en × light/dark)
      One attachment, two addresses. The upper panel is the bridge's side of the
      story — the file on disk under `~/.dsh-wechat/tempfile/` whose leaf name
      the bridge flattened to `__.csv`, with the original name recoverable only
      from the marker left in the message text. The middle strip is the four
      proofs `inbox_adopt` runs before it writes (inboxDir containment, regular
      file ceiling, safe leaf name, collision numbering). The lower panel is the
      workspace side: the observed adoption from this repository's acceptance
      run — `phone-inbox/材料.csv`, `copyMethod: node-fs` — the form a
      workspace-confined consumer such as `dsh-data-quality` accepts.

  flow 1100×660 (hand-written SVG, 2 files)
      Two bands, one boundary.
        Band 1 — `inbox_list`, read-only: the bridge's text markers, the host's
          structured attachment blocks and the off-by-default tempdir scan
          converge into one spine (matcher → merge → stat → order), and diverge
          again into `items[]`, `emptyReason` and `{ ok: false, reason }`.
        Band 2 — `inbox_adopt`, the only copy: a vertical four-gate ladder on the
          outside, one crossing of the workspace boundary, then the write-channel
          fork (`ctx.fs.writeText` / `node:fs`) converging on the workspace file
          and its bare `relativePath`.

Text and values come from this repository, not from imagination:
  src/provider-base.ts       MAX_ADOPT_BYTES = 256 MiB, -1..-99 collision loop,
                             TEXT_EXTENSIONS, copyMethod 'fs-service' | 'node-fs',
                             safeBasename/containedJoin, nameRestored
  src/markers.ts             `文件已保存到: <path>`, `[收到文件: <name>]`, the
                             bridge flattening non-ASCII to `_`
  src/service.ts             LIST_REASONS / ADOPT_REASONS (the reason codes shown)
  src/config.ts              defaults: maxItems 5, defaultSubdir phone-inbox,
                             allowTempdirScan false, writeChannel auto
  README.md                  the observed adopt I/O pair:
                             `.../1792414010975-0a67121b-__.csv`
                             → `phone-inbox/材料.csv`, `copyMethod: node-fs`
  src/prompt.ts              system-prompt section `phone-inbox`, order 320

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow + Windows fonts msyh.ttc / msyhbd.ttc / consola.ttf.
"""
from __future__ import annotations

import math
import os
from html import escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD):
    if not os.path.exists(_p):
        raise SystemExit(f"FATAL: font missing: {_p}")

RADIUS = 22
SHADOW = 26

SKIN = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8",
        card="#ffffff", card_edge="#e6e2ef",
        text="#141419", sub="#4d5261", faint="#8f94a4",
        accent="#4B67B4", accent2="#15803d",
        pill="#ece7f9", band="#f5f2fb", grid="#e7e4f0",
        mark="#b45309", mark_bg="#fdf3e9",
        inner="#eef2fc", inner_edge="#cdd8f2",
        shadow=(32, 26, 64), glow2="#7a68c9",
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016",
        card="#1b2231", card_edge="#2e374b",
        text="#f0f3f9", sub="#a8b1c4", faint="#737b8d",
        accent="#8496f5", accent2="#3fb950",
        pill="#242d42", band="#202839", grid="#262f42",
        mark="#d9a441", mark_bg="#2a2216",
        inner="#1e2638", inner_edge="#3a4570",
        shadow=(0, 0, 0), glow2="#8496f5",
    ),
}

FONT_FILES = {"cjk": FONT_CJK, "cjk_bold": FONT_CJK_BOLD,
              "mono": FONT_MONO, "mono_bold": FONT_MONO_BOLD}


def font(size: int, kind: str = "cjk_bold") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_FILES[kind], size)


def hx(s: str) -> tuple[int, int, int]:
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    base = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(base)
    a, b = hx(c1), hx(c2)
    for y in range(h):
        t = 0.15 * (y / h) + 0.85 * (y / h) ** 1.35
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(a, b)))
    return base


def glow(img: Image.Image, cx: int, cy: int, r: int, color: tuple,
         alpha: int = 40) -> Image.Image:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(9, 0, -1):
        rr = r * i / 9
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 10)),))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def card(img: Image.Image, box: tuple, s: dict, radius: int = RADIUS,
         shadow: int = SHADOW, fill: str | None = None,
         edge: str | None = None) -> Image.Image:
    """A soft-shadowed rounded card on the gradient background."""
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    for i in range(shadow, 0, -3):
        sd.rounded_rectangle([x0 - i // 5, y0 + i // 2, x1 + i // 5, y1 + i],
                             radius=radius + i // 5,
                             fill=s["shadow"] + (int(9 * (1 - i / shadow)),))
    base = Image.alpha_composite(img.convert("RGBA"),
                                 sh.filter(ImageFilter.GaussianBlur(10)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=hx(fill or s["card"]),
                        outline=hx(edge or s["card_edge"]), width=2)
    return base.convert("RGB")


_SCRATCH = ImageDraw.Draw(Image.new("RGB", (8, 8)))


def measure(text: str, size: int, kind: str) -> float:
    return _SCRATCH.textlength(text, font=font(size, kind))


def require_w(text: str, size: int, kind: str, max_w: float, what: str) -> None:
    """Fail loudly instead of shipping a clipped label."""
    w = measure(text, size, kind)
    if w > max_w + 0.4:
        raise SystemExit(f"FATAL: {what} overflows: {text!r} needs {w:.1f}px > {max_w}px")


def fit(text: str, kind: str, max_w: float, start: int, minimum: int) -> int:
    size = start
    while size > minimum:
        if measure(text, size, kind) <= max_w:
            return size
        size -= 1
    raise SystemExit(f"FATAL: text does not fit {max_w}px at >= {minimum}px: {text!r}")


def fit_lines(lines: list[str], kind: str, max_w: float, start: int,
              minimum: int) -> int:
    return min(fit(t, kind, max_w, start, minimum) for t in lines)


def pill(img: Image.Image, xy: tuple[int, int], text: str, s: dict,
         size: int = 16, fg: str | None = None, bg: str | None = None,
         kind: str = "cjk_bold") -> tuple[int, int]:
    d = ImageDraw.Draw(img)
    f = font(size, kind)
    w = d.textlength(text, font=f)
    x, y = xy
    h = size + 20
    d.rounded_rectangle([x, y, x + w + 30, y + h], radius=h // 2,
                        fill=hx(bg or s["pill"]))
    d.text((x + 15, y + h / 2), text, font=f, fill=hx(fg or s["accent"]),
           anchor="lm")
    return int(x + w + 30), int(y + h)


def chip(img: Image.Image, xy: tuple[int, int], text: str, fg: str, bg: str,
         size: int = 11, kind: str = "cjk_bold", padx: int = 9,
         height: int = 20) -> int:
    d = ImageDraw.Draw(img)
    f = font(size, kind)
    w = d.textlength(text, font=f)
    x, y = xy
    d.rounded_rectangle([x, y, x + w + padx * 2, y + height],
                        radius=height // 2, fill=hx(bg))
    d.text((x + padx, y + height / 2), text, font=f, fill=hx(fg), anchor="lm")
    return int(w + padx * 2)


def dash_rect(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int],
              color: str, width: int = 2, dash: int = 7, gap: int = 5) -> None:
    x0, y0, x1, y1 = box
    for a, b in (((x0, y0), (x1, y0)), ((x0, y1), (x1, y1)),
                 ((x0, y0), (x0, y1)), ((x1, y0), (x1, y1))):
        dist = math.hypot(b[0] - a[0], b[1] - a[1])
        n = int(dist // (dash + gap)) + 1
        for i in range(n):
            t0 = i * (dash + gap) / dist
            t1 = min((i * (dash + gap) + dash) / dist, 1.0)
            if t0 >= 1:
                break
            d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                    (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)],
                   fill=hx(color), width=width)


def dash_line(d: ImageDraw.ImageDraw, a: tuple[int, int], b: tuple[int, int],
              color: str, width: int = 2, dash: int = 8, gap: int = 6) -> None:
    dist = math.hypot(b[0] - a[0], b[1] - a[1])
    n = int(dist // (dash + gap)) + 1
    for i in range(n):
        t0 = i * (dash + gap) / dist
        t1 = min((i * (dash + gap) + dash) / dist, 1.0)
        if t0 >= 1:
            break
        d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0),
                (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)],
               fill=hx(color), width=width)


def down_chevron(d: ImageDraw.ImageDraw, cx: int, y0: int, y1: int,
                 color: str, width: int = 3) -> None:
    d.line([(cx, y0), (cx, y1 - 7)], fill=hx(color), width=width)
    d.line([(cx - 6, y1 - 8), (cx, y1 - 1), (cx + 6, y1 - 8)],
           fill=hx(color), width=width, joint="curve")


def tick(d: ImageDraw.ImageDraw, x: int, y: int, color: str,
         width: int = 2) -> None:
    """A drawn check mark: the CJK faces here have no U+2713 glyph."""
    d.line([(x, y), (x + 3, y + 4), (x + 9, y - 5)], fill=hx(color),
           width=width, joint="curve")


# Consolas covers ASCII, Latin-1, the arrows and the punctuation used here, but
# no CJK. Anything outside this set is drawn with the CJK face so a path like
# `phone-inbox/材料.csv` never ships as tofu.
_MONO_EXTRA = {0x00B7, 0x2013, 0x2014, 0x2026, 0x2192, 0x2264, 0x2265}


def _mono_safe(ch: str) -> bool:
    return ord(ch) < 0x0250 or ord(ch) in _MONO_EXTRA


def mixed(d: ImageDraw.ImageDraw, x: int, baseline: int, text: str,
          mono_size: int, cjk_size: int, fill: str,
          mono_kind: str = "mono_bold", cjk_kind: str = "cjk_bold") -> int:
    """Draw `text` with a per-run font fallback; returns the end x."""
    runs: list[tuple[str, ImageFont.FreeTypeFont]] = []
    for ch in text:
        f = font(mono_size if _mono_safe(ch) else cjk_size,
                 mono_kind if _mono_safe(ch) else cjk_kind)
        if runs and runs[-1][1].path == f.path and runs[-1][1].size == f.size:
            runs[-1] = (runs[-1][0] + ch, f)
        else:
            runs.append((ch, f))
    for run, f in runs:
        d.text((x, baseline), run, font=f, fill=hx(fill), anchor="ls")
        x += int(round(_SCRATCH.textlength(run, font=f)))
    return x


# --------------------------------------------------------------------------- hero
# The address pair is the one this repository's acceptance run observed; the
# mangled leaf name is the bridge's own flattening rule, not a decoration.
HERO = {
    "zh": dict(
        kicker="DeepSeek Harness 插件 · 入站附件",
        value=["手机发来的附件，取进工作区", "文件名还是发件人写的那个"],
        sub=["只列这次对话真正收到的附件，按需复制；",
             "不新开通道，也不改桥的行为。"],
        meta="inbox_list · inbox_adopt · session/event · maxItems: 5",
        foot="Apache-2.0 · PerryLink DSH plugin family",
        head="同一份字节，两个地址",
        head_chip="只复制一次",
        out_label="工作区之外 · 桥的 tempfile/",
        out_chip="inWorkspace: false",
        out_path="1792414010975-0a67121b-__.csv",
        out_sub="磁盘名被压成 __.csv；标记里还写着原名",
        out_marker="标记 文件已保存到: …/tempfile/  ·  [收到文件: 材料.csv]",
        gate_label="inbox_adopt 先过四道检查",
        gates=["在 inboxDir 内", "普通文件 ≤ 256MB", "落名安全", "重名 -1"],
        copy_label="一次复制",
        in_label="工作区之内 · 会话 workspace",
        in_path="phone-inbox/材料.csv",
        in_sub="relativePath · bytes · sha256 · copyMethod: node-fs",
        in_chip="→ dsh-data-quality",
        footline="nameRestored: true · 源叶名 __.csv · 源文件仍留在桥目录",
    ),
    "en": dict(
        kicker="DeepSeek Harness plugin · inbound inbox",
        value=["Phone files become", "real workspace paths"],
        sub=["Only what this conversation received, copied on demand;",
             "no new channel, no change to the bridge."],
        meta="inbox_list · inbox_adopt · session/event · maxItems: 5",
        foot="Apache-2.0 · PerryLink DSH plugin family",
        head="One copy, two addresses",
        head_chip="copy once",
        out_label="Outside the workspace · bridge tempfile",
        out_chip="inWorkspace: false",
        out_path="1792414010975-0a67121b-__.csv",
        out_sub="flattened on disk; the marker still carries the name",
        out_marker="marker 文件已保存到: …/tempfile/  ·  [收到文件: 材料.csv]",
        gate_label="adopt checks",
        gates=["in inboxDir", "regular ≤ 256MB", "safe leaf name", "no overwrite"],
        copy_label="one copy",
        in_label="Inside the workspace · session",
        in_path="phone-inbox/材料.csv",
        in_sub="relativePath · bytes · sha256 · copyMethod: node-fs",
        in_chip="→ dsh-data-quality",
        footline="nameRestored: true · source leaf __.csv · source stays in the bridge dir",
    ),
}


def hero(lang: str, skin: str) -> None:
    s = SKIN[skin]
    H = HERO[lang]
    W, HT = 1440, 576
    img = gradient(W, HT, s["bg_from"], s["bg_to"])
    img = glow(img, 1160, 40, 420, hx(s["accent"]),
               22 if skin == "light" else 36)
    img = glow(img, 80, 570, 300, hx(s["glow2"]),
               10 if skin == "light" else 15)

    m = 64
    col_w = 596

    # ---- left column: kicker / title / value / sub / meta / footer -----------
    pill(img, (m, 44), H["kicker"], s, size=17)
    d = ImageDraw.Draw(img)

    title = "dsh-phone-inbox"
    title_size = fit(title, "mono_bold", col_w, 62, 50)
    d.text((m - 2, 112), title, font=font(title_size, "mono_bold"),
           fill=hx(s["text"]))

    vf = fit_lines(H["value"], "cjk_bold", col_w, 42, 34)
    for i, line in enumerate(H["value"]):
        require_w(line, vf, "cjk_bold", col_w, "hero value")
        d.text((m, 212 + i * 56), line, font=font(vf, "cjk_bold"),
               fill=hx(s["text"]))

    sf = fit_lines(H["sub"], "cjk", col_w, 22, 18)
    for i, line in enumerate(H["sub"]):
        require_w(line, sf, "cjk", col_w, "hero sub")
        d.text((m + 1, 336 + i * 34), line, font=font(sf, "cjk"),
               fill=hx(s["sub"]))

    require_w(H["meta"], 18, "cjk", col_w, "hero meta")
    require_w(H["foot"], 15, "cjk", col_w, "hero footer")
    d.text((m + 1, 426), H["meta"], font=font(18, "cjk"), fill=hx(s["faint"]))
    d.line([m + 1, 470, m + col_w - 4, 470], fill=hx(s["grid"]), width=2)
    d.text((m + 1, 486), H["foot"], font=font(15, "cjk"), fill=hx(s["faint"]))

    # ---- right: the attachment card -----------------------------------------
    img = card(img, (700, 40, 1376, 512), s, radius=RADIUS, shadow=SHADOW)
    d = ImageDraw.Draw(img)
    d.text((732, 62), H["head"], font=font(17, "cjk_bold"), fill=hx(s["accent"]))
    cw = measure(H["head_chip"], 12, "cjk")
    chip(img, (1344 - int(cw) - 20, 58), H["head_chip"], s["accent"], s["pill"],
         size=12)
    d = ImageDraw.Draw(img)

    # -- outside panel --------------------------------------------------------
    d.rounded_rectangle([732, 100, 1344, 228], radius=14, fill=hx(s["band"]),
                        outline=hx(s["card_edge"]), width=2)
    d.text((752, 116), H["out_label"], font=font(13, "cjk"), fill=hx(s["sub"]))
    require_w(H["out_label"], 13, "cjk", 470, "hero out label")
    cw = measure(H["out_chip"], 12, "mono")
    chip(img, (1344 - int(cw) - 36, 108), H["out_chip"], s["mark"], s["mark_bg"],
         size=12, kind="mono", padx=9, height=21)
    d = ImageDraw.Draw(img)

    path_size = fit(H["out_path"], "mono_bold", 592, 19, 15)
    d.text((752, 150), H["out_path"], font=font(path_size, "mono_bold"),
           fill=hx(s["text"]))
    require_w(H["out_sub"], 13, "cjk", 592, "hero out sub")
    d.text((752, 182), H["out_sub"], font=font(13, "cjk"), fill=hx(s["faint"]))
    require_w(H["out_marker"], 12, "cjk", 592, "hero marker")
    d.text((752, 202), H["out_marker"], font=font(12, "cjk"), fill=hx(s["faint"]))

    # -- the boundary strip with the four proofs ------------------------------
    box = [732, 242, 1344, 306]
    d.rounded_rectangle(box, radius=14, fill=hx(s["pill"]))
    dash_rect(d, box, s["accent"], width=2, dash=7, gap=5)
    d.text((752, 262), H["gate_label"], font=font(12.5, "cjk_bold"),
           fill=hx(s["accent"]))
    require_w(H["gate_label"], 12.5, "cjk_bold", 170, "hero gate label")

    gx = 752 + int(measure(H["gate_label"], 12.5, "cjk_bold")) + 14
    for gate in H["gates"]:
        w = int(measure(gate, 11, "cjk")) + 36
        d.rounded_rectangle([gx, 252, gx + w, 276], radius=12,
                            fill=hx(s["card"]), outline=hx(s["inner_edge"]),
                            width=1)
        tick(d, gx + 11, 264, s["accent2"], width=2)
        d.text((gx + 23, 264), gate, font=font(11, "cjk"), fill=hx(s["sub"]),
               anchor="lm")
        gx += w + 5
    if gx - 8 > 1344:
        raise SystemExit(f"FATAL: hero gate row overflows to {gx - 8}px")

    # the crossing itself
    down_chevron(d, 1038, 307, 328, s["accent"], width=3)
    require_w(H["copy_label"], 12, "cjk", 96, "hero copy label")
    d.text((1024, 317), H["copy_label"], font=font(12, "cjk"),
           fill=hx(s["accent"]), anchor="rm")

    # -- inside panel ---------------------------------------------------------
    d.rounded_rectangle([732, 330, 1344, 452], radius=14, fill=hx(s["inner"]),
                        outline=hx(s["inner_edge"]), width=2)
    d.text((752, 346), H["in_label"], font=font(13, "cjk"), fill=hx(s["sub"]))
    require_w(H["in_label"], 13, "cjk", 420, "hero in label")
    cw = measure(H["in_chip"], 12, "mono")
    chip(img, (1344 - int(cw) - 36, 338), H["in_chip"], s["accent2"], s["band"],
         size=12, kind="mono", padx=9, height=22)
    d = ImageDraw.Draw(img)
    mixed(d, 752, 399, H["in_path"], 20, 21, s["accent"])
    require_w(H["in_path"], 21, "cjk", 560, "hero in path")
    require_w(H["in_sub"], 12, "mono", 592, "hero in sub")
    d.text((752, 416), H["in_sub"], font=font(12, "mono"), fill=hx(s["faint"]))
    require_w(H["footline"], 13, "cjk", 592, "hero footline")
    d.text((732, 472), H["footline"], font=font(13, "cjk"), fill=hx(s["faint"]))

    path = os.path.join(OUT, f"dsh-phone-inbox-hero-{lang}-{skin}.webp")
    img.save(path, "WEBP", quality=90, method=6)
    print(f"hero  {os.path.basename(path):44s} {os.path.getsize(path):>7d} B")


# --------------------------------------------------------------------------- flow
# Hand-written SVG. Every label below is a token or a fact from this repo; the
# geometry is the two-band structure described in the module docstring.

SVG_CJK = "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Source Han Sans SC',sans-serif"
SVG_MONO = "'Consolas','SFMono-Regular','Menlo',ui-monospace,monospace"

FLOW = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8",
        card="#ffffff", edge="#e6e2ef",
        text="#141419", sub="#4d5261", faint="#8f94a4",
        accent="#4B67B4", accent_soft="#ece7f9",
        band="#f5f2fb", band2="#faf8fe", grid="#e7e4f0",
        amber="#b45309", amber_bg="#fdf3e9",
        green="#15803d", green_bg="#eaf6ee",
        wall="#aaa2c8",
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016",
        card="#1b2231", edge="#2e374b",
        text="#f0f3f9", sub="#a8b1c4", faint="#737b8d",
        accent="#8496f5", accent_soft="#242d42",
        band="#202839", band2="#1e2638", grid="#262f42",
        amber="#d9a441", amber_bg="#2a2216",
        green="#3fb950", green_bg="#16271c",
        wall="#556080",
    ),
}


def T(x: float, y: float, text: str, size: float, fill: str, *,
      fam: str = "cjk", weight: int | None = None,
      anchor: str | None = None, extra: str = "") -> str:
    f = SVG_MONO if fam == "mono" else SVG_CJK
    w = f' font-weight="{weight}"' if weight else ""
    a = f' text-anchor="{anchor}"' if anchor else ""
    return (f'<text x="{x:g}" y="{y:g}" fill="{fill}" font-family="{f}" '
            f'font-size="{size:g}"{w}{a}{extra}>{escape(text)}</text>')


def R(x: float, y: float, w: float, h: float, r: float, fill: str,
      stroke: str | None = None, sw: float = 1.4, dash: str | None = None,
      extra: str = "") -> str:
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<rect x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" '
            f'rx="{r:g}" fill="{fill}"{st}{da}{extra}/>')


def P(d: str, stroke: str, sw: float = 1.4, arrow: str | None = None,
      dash: str | None = None) -> str:
    a = f' marker-end="url(#{arrow})"' if arrow else ""
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<path d="{d}" fill="none" stroke="{stroke}" '
            f'stroke-width="{sw}"{da}{a}/>')


def flow(skin: str) -> str:
    s = FLOW[skin]
    out: list[str] = []
    A = out.append

    A('<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="660" '
      'viewBox="0 0 1100 660" role="img" aria-label="dsh-phone-inbox 结构图：'
      '上半是 inbox_list 的只读汇流——桥的文本标记、结构化附件块与默认关闭的 tempdir 扫描'
      '汇入匹配/合并/stat/排序，再分叉出 items[]、emptyReason 与 { ok: false, reason }；'
      '下半是 inbox_adopt 的四道门禁竖梯，一次复制跨过工作区边界，'
      '按 ctx.fs.writeText 或 node:fs 两条写通道落到工作区里的 relativePath">')
    A('<defs>')
    A('<linearGradient id="bg" x1="0" y1="0" x2="0.28" y2="1">'
      f'<stop offset="0" stop-color="{s["bg_from"]}"/>'
      f'<stop offset="1" stop-color="{s["bg_to"]}"/></linearGradient>')
    A('<filter id="soft" x="-25%" y="-25%" width="150%" height="160%">'
      '<feDropShadow dx="0" dy="7" stdDeviation="9" flood-color="#16122c" '
      'flood-opacity="0.10"/></filter>')
    A(f'<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.4" '
      f'markerHeight="6.4" orient="auto-start-reverse">'
      f'<path d="M0 0 L10 5 L0 10 z" fill="{s["accent"]}"/></marker>')
    A(f'<marker id="arrSoft" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
      f'markerHeight="6" orient="auto-start-reverse">'
      f'<path d="M0 0 L10 5 L0 10 z" fill="{s["faint"]}"/></marker>')
    A('</defs>')
    A('<rect width="1100" height="660" fill="url(#bg)"/>')

    # ---- header -------------------------------------------------------------
    A(T(44, 50, "dsh-phone-inbox", 26, s["text"], fam="mono", weight=700))
    A(T(44, 78, "桥把手机附件写在工作区之外；插件只做两件事：找出这次对话真正收到的，按需复制进来。",
        14, s["sub"]))
    A(R(872, 36, 184, 26, 13, s["accent_soft"]))
    A(T(964, 53, "maxItems: 5 · provider: session", 11.5, s["accent"],
        fam="mono", anchor="middle"))
    # ---- band 1: inbox_list -------------------------------------------------
    A(R(44, 100, 1012, 216, 18, s["card"], s["edge"], extra=' filter="url(#soft)"'))
    A(f'<circle cx="70" cy="126" r="12" fill="{s["accent_soft"]}"/>')
    A(T(70, 131, "1", 13, s["accent"], fam="mono", weight=700, anchor="middle"))
    A(T(92, 131, "inbox_list —— 只读清单，不复制", 15, s["text"], weight=700))
    A(T(1036, 130, "每次调用重读 deriveMessages()，不依赖缓存", 11, s["faint"],
        anchor="end"))

    A(T(64, 152, "本会话的用户消息（role: user）", 11, s["faint"]))

    sources = [
        ("桥的文本标记", "文件已保存到: …/__.csv", False),
        ("结构化附件块", "{ type:'file', attachment }", False),
        ("tempdir 扫描（默认关）", "allowTempdirScan: false", True),
    ]
    for i, (title, detail, dashed) in enumerate(sources):
        y = 158 + i * 44
        A(R(64, y, 252, 40, 12, s["band2"], s["wall"] if dashed else s["grid"],
            sw=1.2, dash="5 4" if dashed else None))
        A(T(80, y + 17, title, 13, s["text"], weight=700))
        A(T(80, y + 33, detail, 11, s["faint"], fam="mono"))

    # convergence into the spine
    A(P("M316 178 H326 Q336 178 336 188 V212 Q336 222 336 222", s["wall"], 1.6))
    A(P("M316 222 H336", s["wall"], 1.6))
    A(P("M316 266 H326 Q336 266 336 256 V232 Q336 222 336 222", s["wall"], 1.6))
    A(f'<circle cx="340" cy="222" r="2.6" fill="{s["accent"]}"/>')

    # the shared spine
    A(R(336, 154, 420, 148, 14, s["band"], s["edge"], sw=1.2))
    steps = [
        ("probeInbox(...)", "能力不可达 → { ok: false, reason }，不猜空列表"),
        ("matcher.match(text)", "三个 kind 模板；同一 hostPath 只报一次"),
        ("merge(batches)", "按 hostPath 去重，后出现者胜，再 stat"),
        ("order(items, limit)", "mtime 新→旧，截到 maxItems"),
    ]
    for i, (token, detail) in enumerate(steps):
        y = 158 + i * 36
        A(T(352, y + 16, token, 13, s["accent"], fam="mono", weight=700))
        A(T(352, y + 30, detail, 11, s["sub"]))
        if i < 3:
            A(f'<line x1="352" y1="{y + 34}" x2="740" y2="{y + 34}" '
              f'stroke="{s["grid"]}" stroke-width="1"/>')

    # outputs
    A(R(772, 154, 264, 148, 14, s["card"], s["grid"], sw=1.2))
    A(T(790, 174, "返回（不是异常）", 11.5, s["sub"]))
    A(T(790, 198, "ok: true", 12, s["green"], fam="mono", weight=700))
    A(T(790, 214, "items[] · path / bytes / inWorkspace", 11.5, s["faint"]))
    A(T(790, 242, "emptyReason", 12, s["amber"], fam="mono", weight=700))
    A(T(790, 258, "no-inbound-source | source-missing", 11.5, s["faint"], fam="mono"))
    A(T(790, 286, "ok: false · capability-unavailable", 11.5, s["faint"], fam="mono"))

    # ---- band 2: inbox_adopt ------------------------------------------------
    A(R(44, 332, 1012, 268, 18, s["card"], s["edge"], extra=' filter="url(#soft)"'))
    A(f'<circle cx="70" cy="358" r="12" fill="{s["accent_soft"]}"/>')
    A(T(70, 363, "2", 13, s["accent"], fam="mono", weight=700, anchor="middle"))
    A(T(92, 363, "inbox_adopt —— 只复制一次，只进工作区", 15, s["text"], weight=700))
    A(T(1036, 362, "输入：items[] 里的一条 path（来自消息文本，不可信）", 11.5,
        s["faint"], anchor="end"))

    gates = [
        ("来源归属", "contains(inboxDir, path)", "not-in-inbox"),
        ("目标检查", "isFile · ≤ 256 MB · 可读", "source-missing"),
        ("落名安全", "safeBasename(displayName)", "→ nameRestored"),
        ("落点规划", "containedJoin(subdir)", "destination-exists"),
    ]
    for i, (title, detail, right) in enumerate(gates):
        y = 374 + i * 48
        A(R(64, y, 356, 40, 12, s["band2"], s["grid"], sw=1.2))
        A(f'<circle cx="86" cy="{y + 20}" r="10" fill="{s["accent_soft"]}"/>')
        A(T(86, y + 24, str(i + 1), 11, s["accent"], fam="mono", weight=700,
            anchor="middle"))
        A(T(106, y + 18, title, 13, s["text"], weight=700))
        A(T(106, y + 34, detail, 11.5, s["faint"], fam="mono"))
        A(T(404, y + 34, right, 11,
            s["accent"] if right.startswith("→") else s["amber"],
            fam="mono", anchor="end"))

    # the boundary and the one crossing: the four numbered proofs on the left
    # are the whole precondition; one copy crosses here and nowhere else
    A(f'<line x1="440" y1="368" x2="440" y2="556" stroke="{s["wall"]}" '
      f'stroke-width="1.6" stroke-dasharray="6 5"/>')
    A(P("M420 466 H448", s["accent"], 2.2, "arr"))

    # write-channel fork
    A(P("M452 466 V430 Q452 424 460 424", s["accent"], 2, "arr"))
    A(P("M452 466 V504 Q452 510 460 510", s["accent"], 2, "arr"))
    fork = [
        (400, "ctx.fs.writeText", "文本优先 · 受围栏", "fs-service"),
        (484, "node:fs.writeFile", "字节直写 · 不走围栏", "node-fs"),
    ]
    for y, token, detail, method in fork:
        A(R(460, y, 240, 56, 12, s["band"], s["edge"], sw=1.2))
        A(T(474, y + 20, token, 11.5, s["accent"], fam="mono", weight=700))
        A(T(474, y + 38, detail, 11.5, s["sub"]))
        cw = len(method) * 6.3 + 18
        A(R(700 - cw - 10, y + 6, cw, 20, 10, s["accent_soft"]))
        A(T(700 - cw / 2 - 10, y + 20, method, 11, s["accent"], fam="mono",
            anchor="middle"))
        A(P(f"M700 {y + 28} H712", s["accent"], 1.8, "arr"))

    A(T(64, 580, "writeChannel: auto · fs 失败回落 node:fs · 重名 -1..-99 · "
                 "overwrite 才覆盖", 11.5, s["faint"], fam="mono"))

    # the workspace file
    A(R(714, 372, 322, 200, 14, s["card"], s["grid"], sw=1.2))
    A(T(732, 392, "工作区里的文件（header.cwd）", 11.5, s["sub"]))
    A(T(732, 422, "phone-inbox/材料.csv", 17, s["accent"], fam="mono", weight=700))
    A(f'<line x1="732" y1="436" x2="1018" y2="436" stroke="{s["grid"]}" stroke-width="1"/>')
    fields = [
        ("relativePath", "phone-inbox/材料.csv"),
        ("copyMethod", "node-fs（或 fs-service）"),
        ("nameRestored", "true · leaf __.csv"),
        ("bytes · sha256", "写入后实测"),
    ]
    for i, (key, val) in enumerate(fields):
        A(T(732, 456 + i * 20, key, 11.5, s["faint"], fam="mono"))
        A(T(846, 456 + i * 20, val, 11.5, s["sub"], fam="mono"))
    A(f'<line x1="732" y1="526" x2="1018" y2="526" stroke="{s["grid"]}" stroke-width="1"/>')
    A(T(732, 544, "→ dsh-data-quality", 11.5, s["green"], fam="mono", weight=700))
    A(T(732, 562, "只收工作区内的相对路径，否则 path-escape", 11, s["faint"]))

    # ---- footer -------------------------------------------------------------
    A(T(44, 616, "失败一律 { ok: false, reason, detail }，不猜空列表；没有 header.cwd 直接 no-workspace，"
                 "不退回 process.cwd。", 11.5, s["sub"]))
    A(T(44, 638, "provider: session | tempdir（扫描默认关：inboxDir 全局共享）· 系统提示词 "
                 "phone-inbox order 320 · 订阅 session/event 只观察 user/message", 11.5,
        s["faint"]))
    A('</svg>')
    return "\n".join(out) + "\n"


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            hero(lang, skin)
    for skin in ("light", "dark"):
        path = os.path.join(OUT, f"dsh-phone-inbox-flow-v5-{skin}.svg")
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow(skin))
        print(f"flow  {os.path.basename(path):44s} {os.path.getsize(path):>7d} B")


if __name__ == "__main__":
    main()
