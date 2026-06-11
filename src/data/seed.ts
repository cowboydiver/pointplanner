import type { Project, Line, Station, Edge } from '../types';

export const PROJECT: Project = {
  name: "Q3 Product Launch",
  subtitle: "Aurora v2.0 — go-to-market",
};

export const LINES: Line[] = [
  { id: "design",     name: "Design Line",      color: "#D8392F", short: "DS" },
  { id: "build",      name: "Build Line",        color: "#2563C9", short: "BD" },
  { id: "content",    name: "Content Line",      color: "#1E9C55", short: "CT" },
  { id: "legal",      name: "Compliance Line",   color: "#E0962A", short: "LG" },
  { id: "launch",     name: "Launch Line",       color: "#7A4DD0", short: "LN" },
];

export const STATIONS: Station[] = [
  // ---- Design line (upper) ----
  { id:"kickoff",    name:"Project Kickoff",   lines:["design","content"], col:0, row:3, lp:"left",   status:"done",
    desc:"Align on scope, success metrics and the launch date. Kicks off both the Design and Content lines.",
    owner:"Maya Lin", role:"Program Lead", due:"Apr 28", est:"1 day", tags:["planning"] },
  { id:"research",   name:"User Research",     lines:["design"], col:1, row:2, lp:"top",    status:"done",
    desc:"5 moderated interviews + survey synthesis to validate the v2 direction.",
    owner:"Devon Park", role:"UX Researcher", due:"May 6", est:"1 wk", tags:["discovery"] },
  { id:"wireframes", name:"Wireframes",        lines:["design"], col:2, row:1, lp:"top",    status:"done",
    desc:"Low-fi flows for onboarding, dashboard and settings.",
    owner:"Sana Iyer", role:"Product Designer", due:"May 13", est:"4 days", tags:["design"] },
  { id:"visual",     name:"Visual Design",     lines:["design"], col:3, row:1, lp:"top",    status:"active",
    desc:"High-fidelity comps and component states for the new design system.",
    owner:"Sana Iyer", role:"Product Designer", due:"May 22", est:"1.5 wk", tags:["design","ui"] },
  { id:"designqa",   name:"Design Review",     lines:["design"], col:4, row:1, lp:"top",    status:"locked",
    desc:"Cross-functional design crit and sign-off before engineering handoff.",
    owner:"Maya Lin", role:"Program Lead", due:"May 27", est:"2 days", tags:["review"] },
  { id:"handoff",    name:"Design Handoff",    lines:["design","build"], col:5, row:2, lp:"top", status:"locked",
    desc:"Specs, tokens and assets delivered to engineering. Interchange between Design and Build.",
    owner:"Sana Iyer", role:"Product Designer", due:"May 29", est:"1 day", tags:["handoff"] },

  // ---- Build line (branches into FE/BE, then merges) ----
  { id:"arch",       name:"Architecture",      lines:["build"], col:6, row:2, lp:"bottom", status:"locked",
    desc:"Service boundaries, data model and API contract agreed with the team.",
    owner:"Ravi Shah", role:"Tech Lead", due:"Jun 3", est:"3 days", tags:["eng"] },
  { id:"frontend",   name:"Frontend Build",    lines:["build"], col:7, row:1, lp:"top",    status:"locked",
    desc:"Implement the new UI against the design system. Runs in parallel with Backend.",
    owner:"Iris Wong", role:"Frontend Eng", due:"Jun 17", est:"2 wk", tags:["eng","ui"] },
  { id:"backend",    name:"Backend Build",     lines:["build"], col:7, row:3, lp:"bottom", status:"locked",
    desc:"APIs, migrations and feature flags. Runs in parallel with Frontend.",
    owner:"Ravi Shah", role:"Tech Lead", due:"Jun 17", est:"2 wk", tags:["eng","api"] },
  { id:"integration",name:"Integration",      lines:["build"], col:8, row:2, lp:"top",    status:"locked",
    desc:"Wire frontend to backend, end-to-end happy paths green. Merge point for the two build branches.",
    owner:"Iris Wong", role:"Frontend Eng", due:"Jun 24", est:"4 days", tags:["eng"] },

  // ---- Content line (lower) ----
  { id:"strategy",   name:"Content Strategy",  lines:["content"], col:2, row:4, lp:"bottom", status:"done",
    desc:"Messaging hierarchy, positioning and the launch narrative.",
    owner:"Theo Marsh", role:"Content Lead", due:"May 12", est:"3 days", tags:["content"] },
  { id:"copy",       name:"Copywriting",       lines:["content"], col:3, row:5, lp:"bottom", status:"active",
    desc:"Product copy, in-app strings and the announcement blog draft.",
    owner:"Theo Marsh", role:"Content Lead", due:"May 26", est:"1 wk", tags:["content"] },
  { id:"assets",     name:"Marketing Assets",  lines:["content"], col:5, row:5, lp:"bottom", status:"locked",
    desc:"Hero illustration, social cards and demo video storyboard.",
    owner:"Nadia Cole", role:"Brand Designer", due:"Jun 9", est:"1.5 wk", tags:["brand"] },
  { id:"landing",    name:"Landing Page",      lines:["content"], col:7, row:4, lp:"bottom", status:"locked",
    desc:"Build and QA the marketing site. Feeds the Launch line.",
    owner:"Nadia Cole", role:"Brand Designer", due:"Jun 23", est:"1 wk", tags:["web"] },

  // ---- Compliance line (independent start, merges into Launch) ----
  { id:"legal",      name:"Legal Review",      lines:["legal"], col:4, row:6, lp:"bottom", status:"available",
    desc:"Terms, licensing and third-party dependency review. Independent line — no upstream blockers.",
    owner:"Priya Rao", role:"Counsel", due:"Jun 6", est:"1 wk", tags:["legal"] },
  { id:"privacy",    name:"Privacy Audit",     lines:["legal"], col:6, row:6, lp:"bottom", status:"locked",
    desc:"Data-flow review, DPA updates and consent copy approval.",
    owner:"Priya Rao", role:"Counsel", due:"Jun 16", est:"4 days", tags:["legal","privacy"] },
  { id:"compliance", name:"Compliance Sign-off",lines:["legal"], col:8, row:5, lp:"bottom", status:"locked",
    desc:"Final go/no-go from legal & security. Merges into the Launch line.",
    owner:"Priya Rao", role:"Counsel", due:"Jun 25", est:"2 days", tags:["legal"] },

  // ---- Launch line (right, vertical terminus) ----
  { id:"rc",         name:"Release Candidate", lines:["build","content","launch"], col:9, row:3, lp:"right", status:"locked",
    desc:"Feature-complete build + landing page locked. Major interchange where Build and Content merge into Launch.",
    owner:"Maya Lin", role:"Program Lead", due:"Jun 26", est:"2 days", tags:["release"] },
  { id:"beta",       name:"Beta Release",      lines:["launch"], col:9, row:4, lp:"right", status:"locked",
    desc:"Ship to the beta cohort behind a flag; gather feedback. Needs compliance sign-off.",
    owner:"Maya Lin", role:"Program Lead", due:"Jul 1", est:"1 wk", tags:["release"] },
  { id:"launchday",  name:"Launch 🚀",         lines:["launch"], col:9, row:5, lp:"right", status:"locked",
    desc:"Public launch — flip the flag, publish the post, light the rocket.",
    owner:"Maya Lin", role:"Program Lead", due:"Jul 8", est:"1 day", tags:["release"] },
];

export const EDGES: Edge[] = [
  // Design
  { from:"kickoff",    to:"research",    line:"design" },
  { from:"research",   to:"wireframes",  line:"design", df:true },
  { from:"wireframes", to:"visual",      line:"design" },
  { from:"visual",     to:"designqa",    line:"design" },
  { from:"designqa",   to:"handoff",     line:"design" },
  // Build (branch + merge)
  { from:"handoff",    to:"arch",        line:"build" },
  { from:"arch",       to:"frontend",    line:"build", df:true },
  { from:"arch",       to:"backend",     line:"build", df:true },
  { from:"frontend",   to:"integration", line:"build" },
  { from:"backend",    to:"integration", line:"build" },
  { from:"integration",to:"rc",          line:"build" },
  // Content
  { from:"kickoff",    to:"strategy",    line:"content", df:true },
  { from:"strategy",   to:"copy",        line:"content", df:true },
  { from:"copy",       to:"assets",      line:"content" },
  { from:"assets",     to:"landing",     line:"content", df:true },
  { from:"landing",    to:"rc",          line:"content", df:true },
  // Compliance (independent, merges to Launch)
  { from:"legal",      to:"privacy",     line:"legal" },
  { from:"privacy",    to:"compliance",  line:"legal", df:true },
  { from:"compliance", to:"beta",        line:"legal", df:true },
  // Launch
  { from:"rc",         to:"beta",        line:"launch" },
  { from:"beta",       to:"launchday",   line:"launch" },
];
