import { OpenRouter } from "@openrouter/sdk";

const openrouter = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
const HATE_THRESHOLD = 0.8;

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
          criteria: {
            true: "Attacks or demeans people for race, religion, ethnicity, gender, sexuality, disability or similar",
            false: "No hate speech",
          },
        },
        spam_level: {
          type: "choice",
          instructions:
            "How confident is it that the author is spamming, given `message`, how new their account (`account_created_at`) and server membership (`guild_joined_at`) are, and their `recent_messages`?",
          criteria: {
            no_spam: "Normal message, no spam indicators",
            medium_spam: "Some signals (new account, repetitive content, promotional links) but not conclusive",
            high_spam: "Clear spam: scam links, mass-mention raids, or flooding repeated/near-identical messages",
          },
        },
      },
    },
  });
  const hate = answers.is_hate_speech;
  const spam = answers.spam_level;
  return {
    isHate: hate?.type === "noul" && hate.noul > HATE_THRESHOLD,
    spamLevel: spam?.type === "choice" ? spam.choice : "no_spam",
  };
}
