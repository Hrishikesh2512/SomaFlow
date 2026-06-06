# Contributing to SomaFlow

Thanks for taking the time to contribute! SomaFlow is intentionally modular, so most contributions can be made in a single folder without affecting the rest of the project.

## Table of Contents

* Code of Conduct
* Getting Started
* How to Contribute
* Development Setup
* Project Structure
* Pull Request Guidelines
* Commit Style
* Reporting Bugs
* Requesting Features

## Code of Conduct

This project follows our Code of Conduct (`CODE_OF_CONDUCT.md`). By participating, you agree to uphold it. Please report unacceptable behavior to the maintainers.

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork locally:

```bash
git clone https://github.com/Hrishikesh2512/SomaFlow.git
cd SomaFlow
```

3. Add the upstream remote:

```bash
git remote add upstream https://github.com/your-username/SomaFlow.git
```

4. Install dependencies:

```bash
bun install
```

5. Copy the environment template:

```bash
cp .env.example .env
```

## How to Contribute

### Good First Contributions

| Area     | What to do                                                    |
| -------- | ------------------------------------------------------------- |
| `modes/` | Add a new execution mode or improve an existing system prompt |
| `ai/`    | Improve token streaming, add provider support, fix edge cases |
| `tui/`   | Improve terminal UI layout or add monitoring panels           |
| Docs     | Fix typos, improve examples, add missing documentation        |
| Tests    | Add unit or integration tests for untested paths              |

### Before Starting Large Changes

Open an issue first and describe what you want to build. This helps avoid duplicate work and allows maintainers to provide feedback early.

## Development Setup

```bash
# Run the TUI locally
bun run index.ts

# Type-check without running
bun tsc --noEmit

# Run tests
bun test
```

## Project Structure

```text
SomaFlow/
├── ai/         # LLM integration, streaming, provider routing
├── modes/      # Execution modes and agent logic
├── tui/        # Terminal UI
├── index.ts    # Entry point
```

Each mode in `modes/` is self-contained. You can add, replace, or fork a mode without modifying unrelated parts of the project.

## Pull Request Guidelines

* One PR per concern. Avoid bundling unrelated changes.
* Open an issue first for significant features or architectural changes.
* Keep PRs small and focused for faster reviews.
* Update documentation when behavior, configuration, or setup changes.
* Add tests where applicable.
* Complete the PR template when submitting.

### Branch Naming

```text
feat/short-description
fix/short-description
docs/short-description
refactor/short-description
```

## Commit Style

We follow Conventional Commits:

```text
feat: add Discord integration
fix: handle empty token stream in streaming mode
docs: update environment variable table in README
refactor: extract provider routing into separate module
chore: bump bun lockfile
```

## Reporting Bugs

When reporting bugs, include:

* Operating system and Bun version (`bun --version`)
* Steps to reproduce
* Expected behavior
* Actual behavior
* Relevant logs or error messages

## Requesting Features

When requesting a feature, describe:

* The problem you're solving
* Your proposed solution
* Alternative approaches you've considered

Thanks again for contributing. Every improvement, no matter how small, helps make SomaFlow better for everyone.
