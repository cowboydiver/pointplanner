/* PointPlanner — Tweaks panel (mounts into #tweaks-root, drives window.PP) */
const PP_TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "light",
  "lineWeight": 9,
  "corners": 18,
  "labels": true,
  "accent": "#D8392F"
}/*EDITMODE-END*/;

function PPTweaks() {
  const [t, setTweak] = useTweaks(PP_TWEAK_DEFAULTS);

  React.useEffect(() => { window.PP && window.PP.setTheme(t.theme); }, [t.theme]);
  React.useEffect(() => { window.PP && window.PP.setLineWeight(t.lineWeight); }, [t.lineWeight]);
  React.useEffect(() => { window.PP && window.PP.setCorners(t.corners); }, [t.corners]);
  React.useEffect(() => { window.PP && window.PP.setLabels(t.labels); }, [t.labels]);

  return (
    <TweaksPanel title="Tweaks">
      <TweakSection label="Theme" />
      <TweakRadio label="Map background" value={t.theme}
        options={["light", "dark"]}
        onChange={(v) => setTweak("theme", v)} />
      <TweakSection label="Line style" />
      <TweakSlider label="Line weight" value={t.lineWeight} min={5} max={14} step={1} unit="px"
        onChange={(v) => setTweak("lineWeight", v)} />
      <TweakSlider label="Corner radius" value={t.corners} min={0} max={34} step={2} unit="px"
        onChange={(v) => setTweak("corners", v)} />
      <TweakSection label="Display" />
      <TweakToggle label="Station labels" value={t.labels}
        onChange={(v) => setTweak("labels", v)} />
    </TweaksPanel>
  );
}

ReactDOM.createRoot(document.getElementById("tweaks-root")).render(<PPTweaks />);
