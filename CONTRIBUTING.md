# Contributing to FreedomForge Max

Thank you for your interest in contributing to FreedomForge Max! This project aims to make AI and DeFi intelligence accessible to everyone, and every contribution helps.

## How to Contribute

### Reporting Issues
- Use [GitHub Issues](https://github.com/mattmacleod16-svg/freedomforge-max/issues) to report bugs or request features
- Include steps to reproduce, expected behavior, and actual behavior
- Add screenshots or logs if applicable

### Pull Requests
1. **Fork** the repository
2. **Create a branch** from `main`: `git checkout -b feature/your-feature`
3. **Make your changes** — keep them focused and well-tested
4. **Run tests**: `npm test` (all 166 must pass)
5. **Build**: `npm run build` (must complete with zero errors)
6. **Commit** with a clear message describing what changed and why
7. **Push** and open a Pull Request against `main`

### Development Setup
```bash
git clone https://github.com/mattmacleod16-svg/freedomforge-max.git
cd freedomforge-max
npm ci
cp .env.example .env.local
npm run dev
```

### Code Standards
- **TypeScript** for all new modules in `lib/` and `app/`
- **No lint warnings** — run the existing linters before submitting
- **Test coverage** — add tests for new functionality in `tests/core.test.js`
- **Security first** — never commit secrets, API keys, or credentials
- **Comments** — only where logic needs clarification, not on self-explanatory code

### Areas Where We Need Help
- 🌍 **Translations** — Help us reach 150+ languages
- 🧪 **Testing** — More test coverage for DeFi, NFT, and DAO modules
- 📖 **Documentation** — Tutorials, guides, and API documentation
- 🔗 **Integrations** — New blockchain protocols, AI providers, or exchange connectors
- 🎨 **UI/UX** — Dashboard improvements, mobile responsiveness
- 🛡️ **Security** — Audit findings, vulnerability reports (please report privately)

### Security Vulnerabilities
If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainer directly or use GitHub's private vulnerability reporting.

## Code of Conduct
- Be respectful and constructive
- Welcome newcomers and help them get started
- Focus on what's best for the community and for humanity
- No discrimination, harassment, or toxic behavior

## License
By contributing, you agree that your contributions will be licensed under the MIT License.
