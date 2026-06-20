// Per-value branding: each core value has its own colour, icon and the four
// behaviours that represent it. Question slides are tinted with the value's
// colour and the value-intro slide shows the icon + name + behaviours.
// `key` matches the question's `category` field.
export interface ValueDef {
  key: string;
  name: string;
  color: string;
  /** text colour that reads on top of `color` */
  onColor: "white" | "dark";
  behaviors: string[];
  /** icon asset URL — filled once the SVGs are added to attached_assets/ */
  icon?: string;
}

export const VALUES: ValueDef[] = [
  {
    key: "We Own Our Commitments",
    name: "We Own Our Commitments, No Excuses Just Results",
    color: "#de5e4d",
    onColor: "white",
    behaviors: ["Accuracy", "Proactivity", "Discipline", "Accountability"],
  },
  {
    key: "Trusted Across Generations",
    name: "Trusted Across Generations",
    color: "#ed9e94",
    onColor: "dark",
    behaviors: ["Reliability", "Transparency", "Integrity", "Consistency"],
  },
  {
    key: "Tomorrow Ready",
    name: "Tomorrow Ready",
    color: "#006eb3",
    onColor: "white",
    behaviors: ["Initiative", "Practicality", "Experimentation", "Adaptability"],
  },
  {
    key: "Never Above Learning",
    name: "Never Above Learning",
    color: "#78a8d4",
    onColor: "dark",
    behaviors: ["Curiosity", "Knowledge Sharing", "Humility", "Growth"],
  },
  {
    key: "We Stand Together",
    name: "We Stand Together, We Achieve Together",
    color: "#c6c6c6",
    onColor: "dark",
    behaviors: ["Collaboration", "Inclusion", "Respect", "Support"],
  },
];

export function valueByCategory(category?: string | null): ValueDef | undefined {
  if (!category) return undefined;
  const c = category.trim().toLowerCase();
  return VALUES.find((v) => v.key.toLowerCase() === c);
}
