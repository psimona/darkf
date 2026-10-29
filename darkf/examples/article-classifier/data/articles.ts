export interface Article {
  id: string;
  title: string;
  text: string;
}

export const articles: Article[] = [
  {
    id: "a1",
    title: "New chip promises 10x inference speedup",
    text: "A startup unveiled a chip design claiming an order-of-magnitude improvement in inference throughput for large language models, at a fraction of the power draw of current GPUs.",
  },
  {
    id: "a2",
    title: "Exoplanet found in habitable zone of nearby star",
    text: "Astronomers using a new survey telescope identified a rocky exoplanet orbiting within the habitable zone of a star 40 light-years away, a strong candidate for atmospheric follow-up.",
  },
  {
    id: "a3",
    title: "Retailer reports record quarterly earnings",
    text: "A national retail chain posted its strongest quarterly earnings in a decade, citing holiday demand and improved supply chain efficiency across its distribution network.",
  },
  {
    id: "a4",
    title: "Local bakery wins regional sourdough award",
    text: "A family-run bakery took first place in the region's annual bread competition, praised by judges for a distinctive tang developed over a decade-old starter culture.",
  },
  {
    id: "a5",
    title: "Open-source database project reaches 1.0",
    text: "After four years of development, a community-maintained embedded database project shipped its first stable 1.0 release, adding transactional guarantees and a new query planner.",
  },
  {
    id: "a6",
    title: "Study links sleep patterns to memory consolidation",
    text: "Researchers tracking sleep stages in a longitudinal study found a strong correlation between deep sleep duration and next-day recall performance in memory tasks.",
  },
];
