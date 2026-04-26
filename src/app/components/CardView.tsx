import type { Card } from "@whot-rules/deck";

type Props = {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  large?: boolean;
};

export function CardView({ card, onClick, selected, disabled, large }: Props) {
  return (
    <button
      type="button"
      className={[
        "card",
        `shape-${card.shape}`,
        selected && "selected",
        disabled && "disabled",
        large && "large",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={disabled ? undefined : onClick}
      aria-label={`${card.shape} ${card.number}`}
    >
      <div className="num">{card.shape === "whot" ? "★" : card.number}</div>
      <div className="shape-glyph" aria-hidden="true" />
      <div className="num bottom">{card.shape === "whot" ? "★" : card.number}</div>
    </button>
  );
}

export function CardBack({ count }: { count?: number }) {
  return (
    <div className="card-back" aria-label={`face-down deck${count ? ` of ${count}` : ""}`}>
      WHOT
    </div>
  );
}
