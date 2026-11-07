# User-message whitespace verification

The fixture uses synthetic input and the plugin's actual registered `conversation.user.text.node:text` component. The before column uses the previous direct `ContentView` path. Both columns sit in a `white-space: pre-wrap` container, reproducing the relevant published rc.2 user-bubble boundary without copying host components or accessing a real profile.

The intended change is display-only. Raw message data and source offsets must remain intact. Single soft line endings and Markdown hard breaks each produce one displayed break; repeated paragraph separators do not add preformatted empty lines. Code keeps its text, indentation and blank lines. Whitespace-only text slices do not produce empty padded cards. Assistant rendering uses its existing default behavior.

## Reproduce on this supported macOS environment

Requires the repository dependencies, Python 3 standard library and an existing Google Chrome installation. No browser package, account or model key is installed or required.

```sh
node tools/user-message-spacing/build.mjs
python3 -m http.server 17841 --bind 127.0.0.1 --directory tools/user-message-spacing
```

While that temporary server is running, use another terminal:

```sh
python3 tools/user-message-spacing/run-browser.py --output /private/tmp/dsh-user-message-spacing-browser
```

The runner creates and removes a separate temporary Chrome profile for each run. It saves screenshots and computed-layout JSON for Empryo and Paper at 1280, 980 and 500 pixels. Assertions check paragraph height and unchanged text, exact three-line soft/hard-break examples, code text and whitespace policy, whitespace-only cards, inert iframe-like input and outer overflow. Stop the temporary server after the run.

The 1280/980 widths match native desktop acceptance; 500 is an additional narrow component stress case supported by this headless Chrome build. These browser checks cover synthetic component layout. They do not prove a real profile was updated or every native attachment/reference/steering path was exercised. The source gate, exact package installation and native App acceptance remain separate evidence.
