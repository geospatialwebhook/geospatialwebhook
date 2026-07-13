module.exports = {
  title: "Python Geospatial Webhook & Event-Driven Architecture",
  short: "Geo Webhook",
  url: "https://www.geospatialwebhook.com",
  description:
    "Design, build, and scale event-driven spatial systems in Python: feature change triggers, tile updates, sensor routing, idempotency, queues, retries, monitoring.",
  focus:
    "Python geospatial webhooks, event-driven architecture, feature change triggers, tile update events, sensor data routing, spatial idempotency, queue management, retry backoff, monitoring",
  audience: "Platform engineers, GIS backend developers, real-time spatial app builders, SaaS founders",
  themeColor: "#d56360",
  sections: [
    {
      slug: "core-event-fundamentals-architecture",
      title: "Core Event Fundamentals & Architecture",
      navTitle: "Architecture",
      summary:
        "Pub/sub, partitioning, event sourcing, sensor routing, tile pipelines, webhook security — the architectural baseline for spatial event systems.",
      icon: "compass",
      tone: "peach",
    },
    {
      slug: "idempotency-spatial-deduplication",
      title: "Idempotency & Spatial Deduplication",
      navTitle: "Idempotency",
      summary:
        "Deterministic keys, cache-backed checks, tolerance-based overlap detection, and conflict resolution for repeated geospatial events.",
      icon: "shield",
      tone: "mint",
    },
    {
      slug: "spatial-payload-routing-parsing",
      title: "Spatial Payload Routing & Parsing",
      navTitle: "Routing & Parsing",
      summary:
        "CRS normalization, geometry validation, GeoJSON/Protobuf mapping, async parsing — turn chaotic webhook streams into clean spatial events.",
      icon: "route",
      tone: "earth",
    },
    {
      slug: "queue-management-retry-delivery",
      title: "Queue Management, Retries & Delivery Guarantees",
      navTitle: "Queues & Retries",
      summary:
        "Exponential backoff with jitter, dead-letter queues for spatial payloads, broker selection, and ordering guarantees for high-volume geospatial event streams.",
      icon: "repeat",
      tone: "rose",
    },
    {
      slug: "monitoring-observability-spatial",
      title: "Monitoring & Observability for Spatial Pipelines",
      navTitle: "Monitoring",
      summary:
        "Geo-specific metrics, consumer lag and partition skew detection, structured logging, and distributed tracing for production spatial webhook systems.",
      icon: "activity",
      tone: "peach",
    },
  ],
};
