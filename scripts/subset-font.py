"""Optional asset tool. Build a TrueType UI subset from a local Noto Sans CJK font."""

import argparse
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

parser = argparse.ArgumentParser()
parser.add_argument("source", help="Path to Noto Sans CJK SC OTF, TTF, or TTC")
parser.add_argument("--face", type=int, default=2, help="TTC face index")
args = parser.parse_args()

root = Path(__file__).resolve().parents[1]
src = root / "src"
character_pool = "".join(p.read_text(encoding="utf-8") for p in src.rglob("*.js"))
points = set(range(32, 127)) | {
    ord(c) for c in character_pool if ord(c) > 127
}
font = TTFont(args.source, fontNumber=args.face)
cmap = {code: name for code, name in font.getBestCmap().items() if code in points}
order = [".notdef", *sorted(set(cmap.values()) - {".notdef"})]
source = font.getGlyphSet()
glyphs = {}
for name in order:
    recording = DecomposingRecordingPen(source)
    source[name].draw(recording)
    drawable = TTGlyphPen(None)
    if "glyf" in font:
        recording.replay(drawable)
    else:
        recording.replay(Cu2QuPen(drawable, max_err=1, reverse_direction=True))
    glyphs[name] = drawable.glyph()

builder = FontBuilder(font["head"].unitsPerEm, isTTF=True)
builder.setupGlyphOrder(order)
builder.setupCharacterMap(cmap)
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({name: font["hmtx"][name] for name in order})
ascent, descent = font["hhea"].ascent, font["hhea"].descent
builder.setupHorizontalHeader(ascent=ascent, descent=descent)
builder.setupNameTable({
    "familyName": "Jinyao UI",
    "styleName": "Regular",
    "uniqueFontIdentifier": "JinyaoUI-Regular-1",
    "fullName": "Jinyao UI Regular",
    "psName": "JinyaoUI-Regular",
    "version": "Version 1.000",
    "copyright": font["name"].getDebugName(0) or "Copyright 2010-2012 Google Corporation",
    "licenseDescription": "SIL Open Font License 1.1",
})
builder.setupOS2(sTypoAscender=ascent, sTypoDescender=descent, usWinAscent=ascent, usWinDescent=-descent)
builder.setupPost()
builder.save(src / "assets" / "jinyao-ui.ttf")
print(f"Generated {len(cmap)} code points.")
