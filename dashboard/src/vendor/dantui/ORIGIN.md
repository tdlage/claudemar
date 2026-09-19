# DANTUI integration

Source: user-supplied `DANTUI-kit.zip`, DANTUI 0.1.0, revision `6c782f872bfcf5fe082669fdacfdc9b367637ae2`.

`index.tsx` and `styles.css` are unmodified copies of `DANTUI-kit/source/src/`. The kit checksums were verified before integration. Shared dashboard buttons and badges adapt the existing API to these components; workspace forms use the kit's fields and inputs.

The original source documentation is in `README.md`. Fonts and their supplied OFL licenses are in `public/fonts/`. This integration does not grant a new license to the library code.

Host styles live in `src/styles/workspace.css`. Semantic Tailwind colors map to `--dt-*` variables in `src/index.css`. Bridge is the default; Paper uses `data-theme="paper"`. The theme preference is stored under `claudemar_theme`. Fonts are served locally, without external requests.
