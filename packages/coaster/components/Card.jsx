import React from "react";
import { AttractionSprite, CoinToken, StarToken, SteelToken, WoodToken } from "./sprites.jsx";

const TYPE_COLORS = {
  coaster: "#c96a2f",
  ride: "#3f7fbf",
  shop: "#5da24c"
};

function frameColor(card) {
  if (card.subtype === "water") return "#2f9e99";
  return TYPE_COLORS[card.type] || "#888";
}

// A physical-looking attraction card. size: "full" (hand/modal) or "mini" (market).
export default function Card({ card, cost, selected, onClick, size = "full" }) {
  const c = cost || card.cost;
  const color = frameColor(card);
  return (
    <div
      className={
        `game-card ${size}` + (selected ? " selected" : "") + (onClick ? " clickable" : "")
      }
      style={{ "--frame": color }}
      onClick={onClick}
    >
      <div className="card-banner">{card.name}</div>
      <div className="card-art">
        <svg viewBox="-32 -46 64 54">
          <ellipse cx={0} cy={2} rx={26} ry={5} fill="#00000018" />
          <AttractionSprite card={card} />
        </svg>
        <span className="card-type-tag">{card.subtype} {card.type}</span>
      </div>
      <div className="card-cost">
        <span className="cost-item"><CoinToken size={15} />{c.money}</span>
        {c.wood > 0 && <span className="cost-item"><WoodToken size={15} />{c.wood}</span>}
        {c.steel > 0 && <span className="cost-item"><SteelToken size={15} />{c.steel}</span>}
        <span className="cost-footprint" title={`Footprint: ${card.footprint} hex`}>
          {"⬢".repeat(card.footprint)}
        </span>
      </div>
      <div className="card-yield">
        <span className="yield-item"><CoinToken size={14} />+{card.income}/season</span>
        <span className="yield-item"><StarToken size={14} />+{card.reputation}</span>
      </div>
      {size === "full" && <div className="card-flavor">{card.text}</div>}
    </div>
  );
}
