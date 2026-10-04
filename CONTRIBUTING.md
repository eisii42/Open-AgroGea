# Contributing to AgroGea

Thanks for your interest in improving AgroGea. The full contributing guide —
development setup, repository layout, the checks every pull request goes
through, dependency updates and releases — lives in
[`docs/contributing.md`](docs/contributing.md).

## Quick start

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps
npm run dev:standalone   # the app in the browser at http://localhost:5174
```

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run lint
npm run check:rust       # only if you touched src-tauri or Rust dependencies
```

Work on a branch (never commit to `main` directly), keep changes focused,
follow [Conventional Commits](https://www.conventionalcommits.org/) for
messages, and open your pull request against `main`. It will be checked by the
quality gate, CodeQL, secret scanning, a ZAP scan of the web build and an
automated review — see
[Pull request checks](docs/contributing.md#pull-request-checks).

Found a bug or have an idea? Open an
[issue](https://github.com/eisii42/Open-AgroGea/issues). Found a vulnerability?
Report it privately as described in [SECURITY.md](SECURITY.md).
