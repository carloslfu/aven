import { useState, useEffect, useRef } from "react";

import { fetch } from "@tauri-apps/plugin-http";
import { BaseDirectory, writeFile, readFile } from "@tauri-apps/plugin-fs";

import "./App.css";
import { saveClaudeToken, getClaudeToken } from "./store";
import { FaEdit, FaTrash } from "react-icons/fa";
import { Bot } from "lucide-react";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  convertToCoreMessages,
  generateId,
  streamText,
  ToolInvocation,
} from "ai";
import { Message } from "ai/react";

import { anthropicTools } from "./lib/anthropic-tools";
import {
  getCursorPosition,
  getMonitors,
  mouseClick,
  moveMouse,
  takeScreenshot,
} from "./computer";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { mainPrompt } from "./prompts";
import { useGlobalStore } from "./globalStore";
import { cn } from "./lib/utils";
import { scaleCoordinates, ScalingSource } from "./scaling";

type ToolObjectResponseWorkaround = {
  __type__: "object-response";
  object: unknown;
};

function ClaudeAPIKey() {
  const [claudeToken, setClaudeToken] = useState<string>("");
  const [isEditingToken, setIsEditingToken] = useState<boolean>(false);

  useEffect(() => {
    handleLoadClaudeToken();
  }, []);

  async function handleSaveClaudeToken() {
    await saveClaudeToken(claudeToken);
    alert("Claude API Key saved!");
    setIsEditingToken(false);
  }

  async function handleLoadClaudeToken() {
    const token = await getClaudeToken();
    if (token) {
      setClaudeToken(token);
    } else {
      alert("No Claude API Key found!");
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      handleSaveClaudeToken();
    }
  }

  return (
    <div className="absolute top-2 right-2 p-2 bg-white rounded shadow">
      <div className="flex gap-2 items-center">
        <h2 className="text-sm font-semibold">Claude API Key:</h2>
        {isEditingToken ? (
          <input
            type="text"
            value={claudeToken}
            onChange={(e) => setClaudeToken(e.target.value)}
            placeholder="Enter Claude API Key"
            className="px-2 py-1 border rounded text-sm hover:border-gray-300 transition-colors focus:outline-blue-500"
            autoFocus
            onBlur={handleSaveClaudeToken}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <span className="flex items-center gap-2">
            <span
              onClick={() => setIsEditingToken(true)}
              className="px-2 py-1 border rounded cursor-pointer text-sm"
            >
              {claudeToken
                ? `${claudeToken.slice(0, 12)}...`
                : "Click to enter API Key"}
            </span>
            <FaEdit
              onClick={() => setIsEditingToken(true)}
              className="text-blue-500 cursor-pointer hover:text-blue-600 transition-colors text-sm"
            />
          </span>
        )}
      </div>
    </div>
  );
}

function App() {
  const [monitors, setMonitors] = useState<
    Array<{ id: string; is_primary: boolean; width: number; height: number }>
  >([]);

  const {
    messages,
    setMessages,
    addMessage,
    replaceLastMessage,
    updateLastMessage,
  } = useGlobalStore();
  const [inputMessage, setInputMessage] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    getMonitors().then(setMonitors);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function submitMessage(message: string) {
    setInputMessage("");

    const newMessages = [
      ...messages,
      { role: "user", content: message, id: generateId() },
    ] satisfies Message[];

    setMessages(newMessages);

    const claudeAPIKey = await getClaudeToken();

    const anthropic = createAnthropic({
      apiKey: claudeAPIKey,
      headers: {
        "anthropic-dangerous-direct-browser-access": "true",
        "anthropic-beta": "computer-use-2024-10-22",
      },
      fetch: async (input, init) => {
        console.log("fetch", input, init);

        let newInit = {
          ...init,
        };

        /**
         * Workaround for the AI SDK serialization of the tool responses
         */
        if (
          input === "https://api.anthropic.com/v1/messages" &&
          init?.method === "POST" &&
          init?.body
        ) {
          const deserializedBody = JSON.parse(String(init?.body));

          // console.log("deserializedBody");

          if (
            deserializedBody.messages &&
            deserializedBody.messages.length > 0
          ) {
            // console.log("deserializedBody.messages");

            for (const message of deserializedBody.messages) {
              if (
                message.role === "user" &&
                Array.isArray(message.content) &&
                message.content.length > 0
              ) {
                // console.log("message.content");

                for (const part of message.content) {
                  if (
                    part.type === "tool_result" &&
                    part.content &&
                    typeof part.content === "string"
                  ) {
                    // console.log("tool result", part);

                    const toolResult = JSON.parse(part.content);

                    if (toolResult.__type__ === "object-response") {
                      // replace the tool result with the non-serialized version
                      part.content = toolResult.object;

                      // console.log("toolResult.object", toolResult.object);
                    }
                  }
                }
              }
            }

            newInit.body = JSON.stringify(deserializedBody);
          }
        }

        // append request to file
        const request = { input, init: newInit };
        // await writeFile(
        //   "./requests.json",
        //   new TextEncoder().encode(JSON.stringify(request) + "\n\n\n"),
        //   {
        //     append: true,
        //     baseDir: BaseDirectory.AppData,
        //   }
        // );

        return fetch(input, newInit);
      },
    });

    const primaryMonitor = monitors.find((m) => m.is_primary);

    console.log("primaryMonitor", primaryMonitor);

    const computerTool = anthropicTools.computer_20241022({
      displayWidthPx: primaryMonitor?.width ?? 1920,
      displayHeightPx: primaryMonitor?.height ?? 1080,
      execute: async ({ action, coordinate, text }) => {
        // Implement your computer control logic here
        // Return the result of the action
        console.log("Computer tool action:", { action, coordinate, text });

        // TODO: implement this:
        // - "key"
        // - "type"
        // - "left_click_drag"
        // - "middle_click"
        // - "double_click"
        // - "cursor_position";

        if (action === "mouse_move" && coordinate) {
          const scaledCoordinates = scaleCoordinates({
            source: ScalingSource.API,
            screenDimensions: {
              width: primaryMonitor?.width ?? 1920,
              height: primaryMonitor?.height ?? 1080,
            },
            x: coordinate[0],
            y: coordinate[1],
          });

          await moveMouse(scaledCoordinates[0], scaledCoordinates[1]);
        } else if (action === "left_click") {
          console.log("-- Left click:", { coordinate });

          if (coordinate) {
            await mouseClick("left", coordinate[0], coordinate[1]);
          } else {
            await mouseClick("left");
          }
        } else if (action === "right_click") {
          console.log("-- Right click:", { coordinate });

          if (coordinate) {
            const scaledCoordinates = scaleCoordinates({
              source: ScalingSource.API,
              screenDimensions: {
                width: primaryMonitor?.width ?? 1920,
                height: primaryMonitor?.height ?? 1080,
              },
              x: coordinate[0],
              y: coordinate[1],
            });

            await mouseClick(
              "right",
              scaledCoordinates[0],
              scaledCoordinates[1]
            );
          } else {
            await mouseClick("right");
          }
        } else if (action === "screenshot") {
          console.log("-- Screenshot");

          const scaledDimensionsForResize = scaleCoordinates({
            source: ScalingSource.COMPUTER,
            screenDimensions: {
              width: primaryMonitor?.width ?? 1920,
              height: primaryMonitor?.height ?? 1080,
            },
            x: primaryMonitor?.width ?? 1920,
            y: primaryMonitor?.height ?? 1080,
          });

          const screenshot = await takeScreenshot({
            resizeX: scaledDimensionsForResize[0],
            resizeY: scaledDimensionsForResize[1],
          });

          const screenshotBytes = await readFile(screenshot.absoluteFilePath);

          const base64 = await arrayBufferToBase64(screenshotBytes);

          const base64WithDataUrl = "data:image/png;base64," + base64;

          await writeFile(
            "./base64.txt",
            new TextEncoder().encode(base64WithDataUrl),
            {
              baseDir: BaseDirectory.AppData,
            }
          );

          // Tool result with images: https://docs.anthropic.com/en/docs/build-with-claude/tool-use#example-of-tool-result-with-images
          // it goes with a workaround for the AI SDK serialization of the tool responses
          return {
            __type__: "object-response",
            object: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: base64,
                },
              },
            ],
          } satisfies ToolObjectResponseWorkaround;
        } else if (action === "cursor_position") {
          const position = await getCursorPosition();
          return position;
        }
      },
    });

    try {
      const { fullStream } = await streamText({
        model: anthropic("claude-3-5-sonnet-20241022"),
        maxTokens: 8192,
        temperature: 0,
        system: mainPrompt,
        messages: convertToCoreMessages([
          // send the last 3 messages
          // ...newMessages.slice(-3),

          ...newMessages,
        ]),
        tools: {
          computer: computerTool,
        },
        maxSteps: 10,
        experimental_continueSteps: true,
      });

      let text = "";
      let messageId = generateId();

      const toolCalls: ToolInvocation[] = [];
      const toolResults: ToolInvocation[] = [];

      for await (const delta of fullStream) {
        await new Promise((resolve) => setTimeout(resolve, 0));

        // console.log("delta", delta);

        if (delta.type === "text-delta") {
          let previousText = text;
          text += delta.textDelta;

          if (previousText === "") {
            addMessage({
              role: "assistant",
              content: text,
              id: messageId,
            });
          } else {
            replaceLastMessage({
              role: "assistant",
              content: text,
              id: messageId,
            });
          }
        } else {
          if (delta.type === "tool-call") {
            toolCalls.push({
              state: "call",
              toolCallId: delta.toolCallId,
              toolName: delta.toolName,
              args: delta.args,
            });

            console.log("tool call", toolCalls[toolCalls.length - 1]);
          } else if (delta.type === "tool-result") {
            toolResults.push({
              state: "result",
              toolCallId: delta.toolCallId,
              toolName: delta.toolName,
              args: delta.args,
              result: delta.result,
            });

            console.log("tool result", toolResults[toolResults.length - 1]);
          }

          updateLastMessage((message) => ({
            role: "assistant",
            content: text,
            id: messageId,
            toolInvocations: [...toolResults],
          }));
        }
      }

      updateLastMessage((message) => ({
        toolInvocations: [...toolResults],
      }));
    } catch (error) {
      console.error("Error submitting message", error);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setInputMessage("");

      submitMessage(inputMessage);
    }
  }

  async function clearMessages() {
    setMessages([]);
  }

  return (
    <main className="min-h-screen flex flex-col p-8 bg-gray-50">
      <header className="w-full text-center mb-4">
        <h1 className="text-4xl font-bold text-gray-800">Welcome to Aven</h1>
      </header>

      <ClaudeAPIKey />
      <div className="flex flex-col w-full max-w-2xl mx-auto">
        <div
          className="flex flex-col"
          style={{ height: "calc(100vh - 12rem)" }}
        >
          <div className="flex justify-end mb-2">
            <Button
              onClick={clearMessages}
              variant="ghost"
              className="flex items-center gap-2"
            >
              <FaTrash />
              Clear
            </Button>
          </div>
          <div
            className="flex-1 overflow-y-auto space-y-2 p-4 bg-white rounded shadow flex flex-col mb-4"
            style={{ minHeight: 0 }}
          >
            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "py-2 px-4 rounded-2xl whitespace-pre-wrap flex flex-col gap-4",
                  {
                    "bg-gray-200": message.role !== "assistant",
                    "pt-4": message.role === "assistant",
                  }
                )}
                style={{
                  alignSelf:
                    message.role === "assistant" ? "flex-start" : "flex-end",
                  maxWidth: "70%",
                }}
              >
                <div className="flex gap-4">
                  {message.role === "assistant" && (
                    <span className="text-lg text-blue-700 font-semibold rounded-full bg-blue-100 h-fit p-2 w-fit flex items-center justify-center">
                      <Bot />
                    </span>
                  )}
                  {message.content}
                </div>
                <div className="flex items-center gap-2">
                  {message.toolInvocations
                    ?.filter(
                      (toolInvocation) =>
                        toolInvocation.state === "result" &&
                        toolInvocation.toolName === "computer"
                    )
                    .map((toolInvocation) => (
                      <div
                        key={toolInvocation.toolCallId}
                        className="text-xs font-medium px-4 py-2 rounded bg-gray-100 text-gray-700 border border-gray-200 shadow-sm transition-colors h-full flex flex-col gap-1"
                      >
                        <div>💻 Computer</div>
                        <div>
                          <b>Action:</b> {toolInvocation.args.action}
                        </div>
                        {toolInvocation.args.coordinate && (
                          <div>
                            <b>Coordinate:</b> x:{" "}
                            {toolInvocation.args.coordinate[0]}, y:{" "}
                            {toolInvocation.args.coordinate[1]}
                          </div>
                        )}
                        {toolInvocation.args.text && (
                          <div>
                            <b>Text:</b> {toolInvocation.args.text}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
        <div className="flex gap-2 sticky bottom-0 bg-gray-50 pt-2">
          <Textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your message"
            className="flex-1"
            onKeyDown={handleKeyDown}
          />
          <Button onClick={() => submitMessage(inputMessage)}>Send</Button>
        </div>
      </div>
    </main>
  );
}

export default App;

async function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  const blob = new Blob([buffer], {
    type: "application/octet-binary",
  });

  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = function (evt) {
      const dataurl = evt.target?.result;
      if (typeof dataurl === "string") {
        resolve(dataurl.substring(dataurl.indexOf(",") + 1));
      } else {
        resolve("");
      }
    };
    reader.readAsDataURL(blob);
  });
}
