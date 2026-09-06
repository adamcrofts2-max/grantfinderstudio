# Grant Finder Studio

UK funding intelligence and grant-writing platform for Community Interest Companies.

**The promise:** in ninety seconds, from one plain-English paragraph, a CIC knows which
funding opportunities are worth their next twenty hours — and why.

## What makes it different

It is not a grant database and not a chatbot over one.

- **Eligibility is deterministic.** A rules engine decides, not a language model. A wrong
  eligibility verdict costs a volunteer twenty hours, so it is the most heavily tested code
  in the project.
- **CIC eligibility is modelled properly.** Funders admit and exclude CICs in six distinct
  patterns, and applicants misread them in both directions. Nobody else models this.
- **Funder behaviour beats funder rhetoric.** What a funder has actually funded — from open
  360Giving awarded-grants data — predicts fit better than its priorities page.
- **Effort is priced in hours.** £30,000 for nine hours is a different proposition from
  £10,000 for thirty. The product says which is worth doing.
- **Nothing is asserted that cannot be traced.** Every claim in a draft resolves to a
  confirmed, sourced fact, or is visibly flagged as unsupported.

## Status

Early. The domain core is built and fully tested; the application around it is not.
See [`docs/STATUS.md`](docs/STATUS.md).

```bash
npm install
npm test          # 103 tests
npm run typecheck
```

## Documentation

| Document | Contents |
|---|---|
| [`docs/PRODUCT_ARCHITECTURE.md`](docs/PRODUCT_ARCHITECTURE.md) | Market research, ICP, architecture, data model, compliance, MVP scope |
| [`docs/MASTER_IMPLEMENTATION_PROMPT.md`](docs/MASTER_IMPLEMENTATION_PROMPT.md) | The build specification |
| [`docs/STATUS.md`](docs/STATUS.md) | What exists and what the environment blocks |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phased checklist |
