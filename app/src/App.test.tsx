import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import App, { weiToEth } from "./App";

type Deposit = {
  id: number;
  user: string;
  salt: string;
  address: string;
  balance: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function mockResponse(body: unknown, ok = true, text = ""): Response {
  return {
    ok,
    json: async () => body,
    text: async () => text,
  } as Response;
}

describe("weiToEth", () => {
  it("formats zero correctly", () => {
    expect(weiToEth("0x0")).toBe("0");
    expect(weiToEth("0x")).toBe("0");
  });

  it("formats whole ETH amounts", () => {
    // 1 ETH in wei
    expect(weiToEth("0xde0b6b3a7640000")).toBe("1");
    // 2 ETH
    expect(weiToEth("0x1bc16d674ec80000")).toBe("2");
  });

  it("formats fractional ETH with up to 6 decimals", () => {
    // 0.5 ETH
    expect(weiToEth("0x6f05b59d3b20000")).toBe("0.5");
  });
});

describe("App data flow", () => {
  const originalFetch = global.fetch;
  const validAddress = "0x1234567890abcdef1234567890abcdef12345678";

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch!;
    vi.restoreAllMocks();
  });

  it("renders deposits from API", async () => {
    const deposits: Deposit[] = [
      {
        id: 1,
        user: validAddress,
        salt: "0xsalt",
        address: "0xaddr",
        balance: "0x0",
        status: "pending",
        created_at: "",
        updated_at: "",
      },
    ];

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(mockResponse(deposits));

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/deposits?limit=11&offset=0"
    );

    expect(screen.getByRole("heading", { name: "Deposits" })).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("0 ETH")).toBeInTheDocument();
  });

  it("creates a new deposit on button click", async () => {
    const depositsEmpty: Deposit[] = [];
    const afterCreate: Deposit[] = [
      {
        id: 1,
        user: validAddress,
        salt: "0xsalt",
        address: "0xaddr",
        balance: "0x0",
        status: "pending",
        created_at: "",
        updated_at: "",
      },
    ];

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

    fetchMock.mockResolvedValueOnce(mockResponse(depositsEmpty)); // initial GET

    fetchMock.mockResolvedValueOnce(mockResponse({ id: 1 })); // POST

    fetchMock.mockResolvedValueOnce(mockResponse(afterCreate)); // refresh GET

    render(<App />);

    const input = await screen.findByPlaceholderText(
      "0x… (user address, 20 bytes)"
    );

    fireEvent.change(input, {
      target: {
        value: validAddress,
      },
    });

    const button = screen.getByRole("button", { name: "Add Deposit" });
    fireEvent.click(button);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/deposits",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: validAddress }),
      })
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/deposits?limit=11&offset=0"
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows error modal when create request fails", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(mockResponse([])); // initial GET
    fetchMock.mockResolvedValueOnce(mockResponse(null, false, "backend boom")); // failing POST

    render(<App />);

    const input = await screen.findByPlaceholderText(
      "0x… (user address, 20 bytes)"
    );
    fireEvent.change(input, { target: { value: validAddress } });
    fireEvent.click(screen.getByRole("button", { name: "Add Deposit" }));

    expect(await screen.findByText("Error")).toBeInTheDocument();
    expect(await screen.findByText("Create failed: backend boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });
});

