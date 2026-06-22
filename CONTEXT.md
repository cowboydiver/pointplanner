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
| **Tag** | A short keyword attached to a station, shown in its detail panel. Sourced from a GitHub label or from a leading title prefix shared across stations |
| **Label angle** | A map-wide rotation applied to every station label (subway-map style), saved with the map so the orientation travels with it |

## Accounts & sharing

| Term | Definition |
|---|---|
| **Map** | A whole transit-map document: one `project` (name + subtitle) plus its lines, stations and edges. The unit of saving, ownership and sharing |
| **User** | An authenticated person, identified by email. The actor that owns and is granted access to maps |
| **Owner** | The single User who created a map; the only one who can share it or delete it |
| **Editor** | A User granted asynchronous edit access to a shared map — may change anything in it, but not re-share or delete it |
| **Viewer** | A User granted read-only access to a shared map |
| **Share** | The act (and the record) of granting another User an Editor or Viewer role on a map |

### What to avoid here

- Don't say "account" for the person — say **User** (an account is the credential, not the actor)
- Don't say "project" for the whole document — say **Map** (`project` is just the name/subtitle field inside it)
- Don't say "collaborator" generically — name the role: **Editor** or **Viewer**
- Don't say "team", "workspace" or "organization" — there is no such entity; sharing is peer-to-peer between Users

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
