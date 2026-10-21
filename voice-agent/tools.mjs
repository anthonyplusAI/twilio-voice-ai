export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "check_weather",
      description:
        "Get the current weather for a given city. Returns temperature, conditions, and humidity.",
      parameters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "The city name, e.g. 'San Francisco' or 'New York'",
          },
        },
        required: ["city"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_order",
      description:
        "Look up an order by its order number. Returns order status, items, and estimated delivery.",
      parameters: {
        type: "object",
        properties: {
          order_number: {
            type: "string",
            description: "The order number, e.g. '123'",
          },
        },
        required: ["order_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tell_joke",
      description:
        "Tell the caller a short, friendly joke. Use when the caller asks for a joke, wants to laugh, or asks you to be funny.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "transfer_to_agent",
      description:
        "Transfer the caller to a human agent. Use only when the caller explicitly asks to speak with a real person, a manager, or a human agent, or when the situation clearly needs human judgment.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Short machine-friendly reason, e.g. 'billing_dispute' or 'caller_requested_human'",
          },
          summary: {
            type: "string",
            description: "One- to two-sentence summary recorded in handoff metadata for a future agent workspace integration.",
          },
        },
        required: ["reason", "summary"],
      },
    },
  },
];

export const HANDOFF_TOOL_NAME = "transfer_to_agent";

const JOKES = [
  "Why did the phone break up with the WebSocket? It just could not handle the constant connection.",
  "I asked Twilio how it handles rejection. It said, 'I just send another SMS.'",
  "Why do VoIP engineers make terrible secret keepers? Everything they say gets packet-sniffed.",
  "My phone and I are in a long-distance relationship. The latency is killing us.",
  "Why did the developer go broke? Because they used up all their cache.",
  "Why do programmers prefer dark mode? Because light attracts bugs.",
  "A SQL query walks into a bar, goes up to two tables and asks: can I join you?",
];

const MOCK_WEATHER = {
  "san francisco": { temp: 60, conditions: "Sunny", humidity: 78 },
  "new york": { temp: 75, conditions: "Partly Cloudy", humidity: 55 },
  chicago: { temp: 54, conditions: "Windy", humidity: 65 },
  miami: { temp: 84, conditions: "Humid", humidity: 80 },
  seattle: { temp: 58, conditions: "Drizzle", humidity: 82 },
  "los angeles": { temp: 72, conditions: "Clear", humidity: 60 },
  houston: { temp: 88, conditions: "Sunny", humidity: 72 },
  atlanta: { temp: 76, conditions: "Partly Cloudy", humidity: 68 },
  boston: { temp: 62, conditions: "Cloudy", humidity: 62 },
  denver: { temp: 66, conditions: "Clear", humidity: 35 },
};

// Guided Explorer demos ask for San Francisco and Seattle weather in the
// selected language. The model may pass the spoken city name through unchanged.
const CITY_ALIASES = {
  "旧金山": "san francisco",
  "舊金山": "san francisco",
  "सैन फ्रांसिस्को": "san francisco",
  "सैन फ़्रांसिस्को": "san francisco",
  "são francisco": "san francisco",
  "сан-франциско": "san francisco",
  "西雅图": "seattle",
  "西雅圖": "seattle",
  "सिएटल": "seattle",
  "सियाटल": "seattle",
  "сиэтл": "seattle",
  "сиэтле": "seattle",
};

const MOCK_ORDERS = {
  "123": {
    status: "Shipped",
    items: "SIGNAL Shirt",
    delivery: "Tomorrow",
  },
  "456": {
    status: "Processing",
    items: "Twilio Sticker Pack",
    delivery: "Not available yet",
  },
  "789": {
    status: "Delivered",
    items: "Twilio Hoodie, Twilio Notebook",
    delivery: "Already delivered",
  },
};

const SUPPORTED_CITIES = "San Francisco, New York, Chicago, Miami, Seattle, Los Angeles, Houston, Atlanta, Boston, or Denver";
const SUPPORTED_ORDERS = "123, 456, or 789";

export function executeTool(name, args) {
  switch (name) {
    case "check_weather": {
      const city = typeof args.city === "string"
        ? args.city.normalize("NFKC").trim().toLowerCase() : "";
      const weather = MOCK_WEATHER[CITY_ALIASES[city] || city];
      if (!weather) {
        return JSON.stringify({
          error: `"${args.city}" is not in the workshop mock data. This is demo data, not a live weather API. Supported cities: ${SUPPORTED_CITIES}.`,
        });
      }
      return JSON.stringify({
        city: args.city,
        temperature_f: weather.temp,
        conditions: weather.conditions,
        humidity_percent: weather.humidity,
      });
    }
    case "lookup_order": {
      const orderNum = (args.order_number || "").trim();
      const order = MOCK_ORDERS[orderNum];
      if (!order) {
        return JSON.stringify({
          error: `Order "${args.order_number}" is not in the workshop mock data. This is demo data, not a live order system. Supported order numbers: ${SUPPORTED_ORDERS}.`,
        });
      }
      return JSON.stringify({
        order_number: orderNum,
        status: order.status,
        items: order.items,
        estimated_delivery: order.delivery,
      });
    }
    case "tell_joke": {
      const joke = JOKES[Math.floor(Math.random() * JOKES.length)];
      return JSON.stringify({ joke });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}
