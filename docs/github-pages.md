# GitHub Pages Development

## Preview the site locally

Serve the folder over HTTP instead:

```sh
cd github-pages
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. Alternatively, use the VS Code
[Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer)
extension or run `npx serve github-pages`.

## Add inspiration designs

- Inspiration designs live in [`github-pages/inspiration/`](../github-pages/inspiration/)
as one JSON file per design.
- Add each filename to
[`github-pages/inspiration.json`](../github-pages/inspiration.json) so the
planner can discover and display it.
- Downloaded design files (json) from the designer use this same format and can be directly placed in the inspiration directory.
- The `grid` property contains seven 52-character rows:
    - `.` is an empty spot in the grid
    - `r` red,
    - `o` orange
    - `y` yellow
    - `g` green
    - `b` blue
    - `i` pink
    - `p` purple
    - `w` white
    - `n` gray
    - `k` black
- Custom colors are listed in the optional `customColors` array and referenced in order with `1`–`9`.


## Deployment

- The github pages site is automatically deployed if any file changes in the `github-pages` folder are pushed to the `main` branch.