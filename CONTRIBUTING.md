# Contributing to AgroGea

Thanks for your interest in improving AgroGea. The full contributing guide,
including development setup, the repository layout, the quality gate, and the
pull request workflow, lives in [`docs/contributing.md`](docs/contributing.md).

## Quick start

```bash
git clone https://github.com/eisii42/Open-AgroGea.git
cd Open-AgroGea
npm install --legacy-peer-deps
npm run dev:standalone   # standalone OSS edition at http://localhost:5174
```

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run lint
```

Branch off `main` (never commit to it directly), keep changes focused, follow
[Conventional Commits](https://www.conventionalcommits.org/) for messages, and
open your pull request against `main`. Found a bug or have an idea? Open an
[issue](https://github.com/eisii42/Open-AgroGea/issues).
