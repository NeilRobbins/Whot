import type { Shape } from "./deck";

export type WhotRulesConfig = {
  name: "standard" | "nigerian" | "custom";
  initialHandSize: number;
  shapes: Shape[];
  specialCards: {
    holdOn?: number[];
    pickTwo?: number[];
    pickThree?: number[];
    suspend?: number[];
    generalMarket?: number[];
    whot?: number[];
  };
  stacking: {
    pickTwo: boolean;
    pickThree: boolean;
    mixedPenaltyStacking: boolean;
  };
  lastCardDeclaration: {
    required: boolean;
    penaltyCards: number;
  };
  drawPolicy: "draw_ends_turn" | "draw_then_may_play";
  emptyDrawPilePolicy: "reshuffle_discard_except_top" | "stalemate";
};

export const STANDARD_RULES: WhotRulesConfig = {
  name: "standard",
  initialHandSize: 6,
  shapes: ["circle", "triangle", "cross", "square", "star", "whot"],
  specialCards: {
    holdOn: [1],
    pickTwo: [2],
    pickThree: [5],
    suspend: [8],
    generalMarket: [14],
    whot: [20],
  },
  stacking: {
    pickTwo: true,
    pickThree: true,
    mixedPenaltyStacking: false,
  },
  lastCardDeclaration: {
    required: true,
    penaltyCards: 2,
  },
  drawPolicy: "draw_ends_turn",
  emptyDrawPilePolicy: "reshuffle_discard_except_top",
};
