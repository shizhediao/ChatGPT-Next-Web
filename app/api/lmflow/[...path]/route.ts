import { RequestMessage } from "@/app/client/api";
import { OpenaiPath } from "@/app/constant";
import { NextRequest, NextResponse } from "next/server";
import process from "process";

process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0";

function makeMessage(text: string) {
  return {
    choices: [
      {
        delta: {
          content: text,
        },
      },
    ],
  };
}

const LMFLOW_URL =
  process.env.LMFLOW_URL || "https://lmflow3.math.ust.hk:5000/predict";

console.log("[LMFlow] url = ", LMFLOW_URL);

async function createStream(res: Response, onFinish = (text: string) => {}) {
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  let lastText = "";
  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();

      async function readChunk() {
        const { done, value } = await reader.read();
        if (done) {
          console.log("Finished reading the response");
          controller.close();
          onFinish(lastText);
          return;
        }

        const msg = decoder.decode(value, { stream: true });
        const delta = msg.slice(lastText.length);
        lastText = msg;

        // Process the chunk of data
        console.log("Received chunk:", msg);
        console.log("Received delta:", delta);
        const queue = encoder.encode(
          `data: ${JSON.stringify(makeMessage(delta))}\n\n`,
        );
        controller.enqueue(queue);

        readChunk();
      }

      readChunk();
    },
  });

  return stream;
}

type RequestPayload = {
  messages: RequestMessage[];
};

async function handle(
  req: NextRequest,
  { params }: { params: { path: string[] } },
) {
  console.log("[LMFlow] params ", params);

  if (req.method === "OPTIONS") {
    return NextResponse.json({ body: "OK" }, { status: 200 });
  }

  const subpath = params.path.join("/");
  console.log("[LMFlow] sub path = ", subpath);

  if (OpenaiPath.ChatPath === subpath) {
    const payload = (await req.json()) as RequestPayload;
    const roles = {
      user: {
        type: 1,
        name: "User",
      },
      assistant: {
        type: 2,
        name: "Your Assistant",
      },
      system: {
        type: 2,
        name: "Your Assistant",
      },
    };
    const lmPayload = {
      History: payload.messages.map((m) => ({
        ...roles[m.role],
        content: m.content,
      })),
      Input: payload.messages.at(-1)?.content ?? "",
    };

    const response = await fetch(LMFLOW_URL, {
      method: "POST",
      body: JSON.stringify(lmPayload),
      headers: { "Content-Type": "application/json" },
    });

    const stream = await createStream(response);
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  return NextResponse.json({ body: "无效的路径：" + subpath }, { status: 403 });
}

export const GET = handle;
export const POST = handle;

// export const runtime = "edge";
