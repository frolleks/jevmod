import { OpenRouter } from "@openrouter/sdk";

const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const HATE_REMOVE_THRESHOLD = 0.8; // above: delete the message
const HATE_REVIEW_THRESHOLD = 0.5; // above (up to remove): flag it to the mods
const HATE_CRITERIA = {
  true: "Attacks or demeans people for race, religion, ethnicity, gender, sexuality, disability or similar",
  false: "No hate speech",
};

export async function judge(state: {
  message: string;
  account_created_at: string;
  guild_joined_at: string | null;
  recent_messages: string[];
}) {
  const { answers } = await openrouter.alpha.decisions.create({
    decisionsRequest: {
      model: "typesafe/jev-1.13",
      state,
      questions: {
        is_hate_speech: {
          type: "noul",
          instructions: "Is `message` hate speech?",
          criteria: HATE_CRITERIA,
        },
        spam_level: {
          type: "choice",
          instructions:
            "How confident is it that the author is spamming, given `message`, how new their account (`account_created_at`) and server membership (`guild_joined_at`) are, and their `recent_messages`?",
          criteria: {
            no_spam: "Normal message, no spam indicators",
            medium_spam:
              "Some signals (new account, repetitive content, promotional links) but not conclusive",
            high_spam:
              "Clear spam: scam links, mass-mention raids, or flooding repeated/near-identical messages",
          },
        },
      },
    },
  });
  const hate = answers.is_hate_speech;
  const spam = answers.spam_level;
  const hateScore = hate?.type === "noul" ? hate.noul : 0;
  const hateLevel: "none" | "review" | "remove" =
    hateScore > HATE_REMOVE_THRESHOLD ? "remove" : hateScore > HATE_REVIEW_THRESHOLD ? "review" : "none";
  return {
    hateScore,
    hateLevel,
    spamLevel: spam?.type === "choice" ? spam.choice : "no_spam",
    // probability of the chosen level, comparable to hateScore; null if the API omits the distribution
    spamScore: spam?.type === "choice" ? (spam.probabilities?.[spam.choice] ?? null) : null,
  };
}

// probability (0-1) that the reported messages contain hate speech
export async function scoreHateSpeech(messages: string[]) {
  const { answers } = await openrouter.alpha.decisions.create({
    decisionsRequest: {
      model: "typesafe/jev-1.13",
      state: { messages },
      questions: {
        is_hate_speech: {
          type: "noul",
          instructions: "Does any message in `messages` contain hate speech?",
          criteria: HATE_CRITERIA,
        },
      },
    },
  });
  const a = answers.is_hate_speech;
  if (a?.type !== "noul") throw new Error("Jev returned no hate speech answer");
  return a.noul;
}
