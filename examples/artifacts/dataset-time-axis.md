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
A summary with no interval: put refused: timeAxis.aggregate summarises an interval, so timeAxis.interval must say how wide it is.
```

The producer's rows keep time as epoch seconds under a column called `ts`. A viewer
can't guess that safely, so the dataset declaration carries `timeAxis` beside the
rows. It names the column, its unit, the interval each row stands for, and how
each measure was summarised in it. The ticket carries the declaration, so a viewer
reads it with `readTimeAxis` and titles the chart with `describeTimeAxis`. That is
the same wording on every screen.

The last line shows the refusal. A summary with no interval is half a declaration,
and the store refuses it by name instead of repairing it. The store never reads
the rows to check the declaration. A declared column that the rows lack is for the
viewer to report as an error.
