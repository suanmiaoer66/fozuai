# PDF export font

These fonts come from the Simplified Chinese Noto CJK font, distributed under
the SIL Open Font License in `OFL.txt`. Glyph outlines are unchanged. WOFF2
provides lossless compression; the common font additionally selects a documented
character subset. The complete font remains available as a fallback.

Source: https://github.com/notofonts/noto-cjk/blob/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf

`NotoSansSC-Common.woff2` covers 8,741 codepoints (GB2312, supported Latin and
symbols, Chinese punctuation, and fullwidth characters), and is about 1.5 MB.
The exporter checks the entire title and Markdown body before choosing it. If
any non-whitespace character is outside this exact manifest, the exporter uses
`NotoSansSC-Regular.woff2` instead: its 30,890 codepoints and 31,036 glyphs match
the upstream OTF exactly. It is about 6.1 MB, compared to the 8.3 MB OTF.

Fonts load only when exporting a PDF and successful downloads are cached for the
current tab. The first export on a slow network may take some time; its font
download timeout is two minutes, and failed downloads can be retried. pdfmake
embeds only the glyphs used, so downloaded PDFs remain small, selectable, and
readable without fonts installed on the receiving device.

To reproduce the assets, install `fonttools==4.67.0` and `brotli==1.2.1` in a
temporary environment, obtain the upstream OTF at the source above, and run:

```sh
python scripts/build-pdf-fonts.py /path/to/NotoSansSC-Regular.otf
```

The script verifies the full font's character map and glyph order, verifies the
common font's character map, and writes `src/workspace/commonFontCharacters.json`
plus `font-metadata.json` (source hash, byte sizes, glyph counts, and font hashes).
