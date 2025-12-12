import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface CheckRequest {
  transcript: string;
}

interface CategoryResult {
  found: boolean;
  excerpts: string[];
}

interface CategoryCheck {
  goals: CategoryResult;
  fears: CategoryResult;
  working_on: CategoryResult;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: CheckRequest = await req.json();
    const { transcript } = body;

    if (!transcript || transcript.trim().length < 10) {
      return NextResponse.json({
        ok: true,
        categories: {
          goals: { found: false, excerpts: [] },
          fears: { found: false, excerpts: [] },
          working_on: { found: false, excerpts: [] },
        },
      });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are analyzing a transcript of someone speaking about themselves during an onboarding process.
They were asked to talk about three topics:
1. Goals - their aspirations, what they want to achieve
2. Fears - their concerns, worries, challenges they're facing
3. Working on - their current projects, job, school, or focus areas

Analyze the transcript and determine if they have at least briefly mentioned each topic.
Be lenient - if they mention anything related to these categories, mark it as found.
For example: "I want to be successful" counts as goals, "I'm worried about..." counts as fears, "I'm a student at..." counts as working_on.

For each category, also extract the EXACT text excerpts from the transcript that relate to that category.
Copy the text EXACTLY as it appears - do not paraphrase or modify it. Include enough context to make sense (a phrase or sentence).`,
        },
        {
          role: "user",
          content: `Transcript so far:\n\n"${transcript}"\n\nWhich categories have they talked about?`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "category_check",
          strict: true,
          schema: {
            type: "object",
            properties: {
              goals: {
                type: "object",
                description: "Information about goals/aspirations mentioned",
                properties: {
                  found: {
                    type: "boolean",
                    description: "True if they mentioned any goals, aspirations, or things they want to achieve",
                  },
                  excerpts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Exact text excerpts from the transcript that relate to goals",
                  },
                },
                required: ["found", "excerpts"],
                additionalProperties: false,
              },
              fears: {
                type: "object",
                description: "Information about fears/concerns mentioned",
                properties: {
                  found: {
                    type: "boolean",
                    description: "True if they mentioned any fears, worries, concerns, or challenges",
                  },
                  excerpts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Exact text excerpts from the transcript that relate to fears",
                  },
                },
                required: ["found", "excerpts"],
                additionalProperties: false,
              },
              working_on: {
                type: "object",
                description: "Information about current work/projects mentioned",
                properties: {
                  found: {
                    type: "boolean",
                    description: "True if they mentioned what they're currently working on, their job, school, or projects",
                  },
                  excerpts: {
                    type: "array",
                    items: { type: "string" },
                    description: "Exact text excerpts from the transcript that relate to what they're working on",
                  },
                },
                required: ["found", "excerpts"],
                additionalProperties: false,
              },
            },
            required: ["goals", "fears", "working_on"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return NextResponse.json({
        ok: true,
        categories: {
          goals: { found: false, excerpts: [] },
          fears: { found: false, excerpts: [] },
          working_on: { found: false, excerpts: [] },
        },
      });
    }

    const categories: CategoryCheck = JSON.parse(content);
    return NextResponse.json({ ok: true, categories });
  } catch (err) {
    console.error("[transcribe/check] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
