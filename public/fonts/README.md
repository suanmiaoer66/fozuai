# PDF export font

`NotoSansSC-Regular.otf` is the unmodified Simplified Chinese subset font from the
Noto CJK project, distributed under the SIL Open Font License in `OFL.txt`.

Source: https://github.com/notofonts/noto-cjk/blob/main/Sans/SubsetOTF/SC/NotoSansSC-Regular.otf

The browser downloads this self-hosted font only when exporting the first PDF,
then caches it for subsequent exports in the same tab. pdfmake embeds a subset
of the characters actually used in each PDF so its Chinese text remains
selectable and readable without fonts installed on the receiving device.
