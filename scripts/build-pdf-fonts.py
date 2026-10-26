#!/usr/bin/env python3
"""Build lossless WOFF2 fonts and the exact common-character coverage manifest.

Requires fonttools==4.67.0 and brotli==1.2.1. Pass the unmodified upstream
NotoSansSC-Regular.otf; this script never downloads or installs anything.
"""

import argparse
import hashlib
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

SOURCE_URL = 'https://github.com/notofonts/noto-cjk/blob/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf'
ROOT = Path(__file__).resolve().parent.parent


def is_common(codepoint):
    try:
        chr(codepoint).encode('gb2312')
        return True
    except UnicodeEncodeError:
        return codepoint < 0x3040 or 0xFF00 <= codepoint < 0xFFF0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    destination = ROOT / 'public/fonts'
    destination.mkdir(parents=True, exist_ok=True)
    original = TTFont(args.source, recalcTimestamp=False)
    full_cmap = original.getBestCmap()
    original.flavor = 'woff2'
    full_path = destination / 'NotoSansSC-Regular.woff2'
    original.save(full_path)
    full = TTFont(full_path)
    assert full.getBestCmap() == full_cmap
    assert full.getGlyphOrder() == original.getGlyphOrder()

    common_codepoints = sorted(codepoint for codepoint in full_cmap if is_common(codepoint))
    common = TTFont(args.source, recalcTimestamp=False)
    options = subset.Options()
    options.flavor = 'woff2'
    options.recalc_timestamp = False
    options.name_IDs = ['*']
    options.name_languages = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=common_codepoints)
    subsetter.subset(common)
    common.flavor = 'woff2'
    common_path = destination / 'NotoSansSC-Common.woff2'
    common.save(common_path)
    assert set(TTFont(common_path).getBestCmap()) == set(common_codepoints)
    manifest = ROOT / 'src/workspace/commonFontCharacters.json'
    manifest.write_text(json.dumps(''.join(chr(codepoint) for codepoint in common_codepoints), ensure_ascii=False) + '\n', encoding='utf-8')
    metadata = {
        'source': SOURCE_URL,
        'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'toolchain': {'fonttools': '4.67.0', 'brotli': '1.2.1'},
        'common_selection': 'GB2312 plus supported Unicode U+0000–U+303F and U+FF00–U+FFEF',
        'fonts': {
            path.name: {
                'bytes': path.stat().st_size,
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'unicode_codepoints': len(TTFont(path).getBestCmap()),
                'glyphs': len(TTFont(path).getGlyphOrder()),
            }
            for path in [common_path, full_path]
        },
    }
    (destination / 'font-metadata.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(metadata, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
