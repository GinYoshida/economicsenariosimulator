"use client";

export type DriverSliderSpec = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
};

/** 各ドライバーの想定水準を操作するスライダー群。 */
export default function DriverSliders({
  sliders,
  onChange,
}: {
  sliders: DriverSliderSpec[];
  onChange: (id: string, value: number) => void;
}) {
  return (
    <section aria-label="ドライバー調整" data-testid="driver-sliders">
      <ul className="flex flex-col gap-3">
        {sliders.map((s) => (
          <li key={s.id} className="flex flex-col gap-1">
            <label htmlFor={`slider-${s.id}`} className="flex justify-between text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums text-gray-500">
                {s.value}
                {s.unit}
              </span>
            </label>
            <input
              id={`slider-${s.id}`}
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={s.value}
              aria-label={s.label}
              onChange={(e) => onChange(s.id, Number(e.target.value))}
              className="w-full"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
