# Braze Dashboard v2 (Single-Page HTML)

This is a Streamlit-free version of the dashboard meant to be embedded directly into a Braze landing page.

## What it does

- Renders a single-page dashboard (HTML/CSS/JS)
- Loads `data/tables/*.csv` from GitHub (`braze-dashboard-cloud`)
- Uses locally-hosted (GitHub) vendor libraries (no CDNs)

## Local preview

Serve the folder and open `index.html` (fetch/XHR is often blocked on `file://` URLs).

Example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/index.html`.

## Braze landing page stub

Copy the contents of `stub.html` into your Braze landing page.
Update the `dataBaseUrl` / `dataVersion` values as needed.

Default data source:

- `https://raw.githubusercontent.com/Johns329/braze-dashboard-cloud/main/data/tables`
