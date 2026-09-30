# Declare which column is time

[Run this example](dataset-time-axis.ts) when a tool returns rows that are a time
series and a viewer should draw them as one without guessing.

```sh
npm run example examples/artifacts/dataset-time-axis.ts
```

The default provider is an offline scripted mock. It produces:

```text
Chart title: IO profile — hourly avg and max.
Time column: ts (epoch-s).
First point: 2024-09-14T08:00:00Z (row 0).
A string with no offset and no zone: naive-values, 1 value not read as UTC.
A summary with no interval: put refused: timeAxis.aggregate summarises an interval, so timeAxis.interval must say how wide it is.
```

The producer's rows keep time as epoch seconds under a column called `ts`. A viewer
can't guess that safely, so the dataset declaration carries `timeAxis` beside the
rows. It names the column, its unit, the interval each row stands for, and how
each measure was summarised in it. The ticket carries the declaration, so a viewer
reads it with `readTimeAxis` and titles the chart with `describeTimeAxis`. That is
the same wording on every screen.

To compare times, a viewer asks for the view: `normaliseInstants(rows, axis)` turns
the declared column into UTC instants at one precision, sorted, each with the row it
came from, so comparing two as text compares them in time. The stored rows are only
read, never rewritten. A string with no offset under an axis with no `zone` could be
any of 24 hours, so the view counts it (`naive-values`) instead of reading it as UTC;
`{ naive: 'refuse' }` places nothing instead. Under a declared `zone`, a wall time the
autumn clock change doubles is placed by the rows' order, and one the order cannot
place is counted too.

The last line shows the refusal. A summary with no interval is half a declaration,
and the store refuses it by name instead of repairing it. The store never reads
the rows to check the declaration. A declared column that the rows lack is for the
viewer to report as an error.
