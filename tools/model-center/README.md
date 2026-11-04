# Model center browser replay

This fixture uses the production public-service adapters, runtime, registered
settings section, view and reversible navigation adapter. All source responses
are injected demonstration data; it never queries an account or model.

```sh
node tools/model-center/build.mjs
python3 -m http.server 17843 --bind 127.0.0.1 --directory tools/model-center
```

The CDP runner accepts the `Browser` helper supplied by design-taste-frontend:

```sh
MODEL_CENTER_CDP_MODULE="$HOME/.codex/skills/design-taste-frontend/scripts/lib/cdp.mjs" \
  node tools/model-center/run-browser.mjs /private/tmp/model-center-browser
```

The helper must already be installed. This test installs nothing. It checks
1280, 980 and 500 pixel viewports, route-qualified model identity, credential
field exclusion, exact definition writes, zero quota, partial source failure,
explicit retry and original settings return without cancelling classification.
It writes screenshots and a machine-readable result outside the repository.
Actual Desktop installation, live source availability and real configuration
preservation require separate native acceptance.
