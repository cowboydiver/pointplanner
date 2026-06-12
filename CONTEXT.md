# CONTEXT.md — PointPlanner

This is the domain glossary and ubiquitous language for PointPlanner. Engineering skills read this before naming things or writing issues.

## What is PointPlanner?

PointPlanner renders a project as a **subway transit map**: tasks are **stations** arranged on a column/row grid; dependencies between tasks are colored **lines** drawn with 45° routing and rounded corners.

## Core concepts

| Term | Definition |
|---|---|
| **Station** | A single task node on the map, placed at a (col, row) grid position |
| **Line** | A named group of stations sharing a color; rendered as a polyline connecting them in order |
| **Edge** | A dependency link between two stations, drawn as a routed SVG path |
| **Prereq** | A station that must be `done` before a dependent station becomes `available` |
| **Dependent** | A station that is blocked until its prereqs are `done` |
| **Status** | One of: `locked` (prereqs not done), `available` (prereqs done, not started), `active` (in progress), `done` |
| **Interchange** | A station that belongs to more than one line |
| **Grid** | The coordinate system: columns spaced `COL=152px` apart from `PAD_X=96`, rows spaced `ROW=94px` apart from `PAD_Y=92` |
| **Routing** | The algorithm that converts an (source, target) station pair into a sequence of 45°-only waypoints |
| **df (diagonal-first)** | Routing flag: when true, the path goes diagonal before going straight; used when source and target are on different rows |

## Status state machine

```
locked → available → active → done
                  ↑            |
                  └────────────┘ (reopen)
```

`recompute` cascades status across the graph whenever any station changes.

## What to avoid

- Don't say "task" when you mean **station** (station is the visual/domain term)
- Don't say "dependency arrow" — it's an **edge**
- Don't say "group" or "category" for a **line** (line is the transit metaphor)
- Don't say "blocked" for a station — say **locked**
- Don't say "unlocked" — say **available**
