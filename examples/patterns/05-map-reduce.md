---
name: mapReduce — fan-out mappers → reduce
group: patterns
guide: ../../docs/guides/patterns.md#mapreduce--fan-out-mappers--reduce
defaultInput: Produce the executive summary.
---

# mapReduce — fan-out mappers → reduce

> **Like:** assigning each book in a stack to a different reader, then having them write a joint summary.

N pre-bound mappers (each runner already has its slice of work baked in) run in parallel, then a reducer combines the results — either an LLM merge call or a custom function.

## When to use

- Summarize N documents.
- Compare N candidates / score against N rubrics.
- Anything embarrassingly parallel where pre-binding the work is natural.

## Provider slots

Two: `mapper` (used for all mappers) and `reducer` (only used when `reduce.mode === 'llm'`).

## Honesty

The shipped factory is the **flat form** — no hierarchical reduce, no recursive splitting. For very large N (hundreds of mappers), build a tree of `mapReduce` calls.

## Background

Map-reduce predates LLMs (Dean & Ghemawat 2004). LLM-flavored variants in the summarization-tree literature.

## Related

- **[docs/guides/patterns.md](../../docs/guides/patterns.md#mapreduce--fan-out-mappers--reduce)** — full pattern reference.
- **[Parallel concept](../concepts/05-parallel.md)** — what `mapReduce` is built on.
