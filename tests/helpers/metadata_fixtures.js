const encoder = new TextEncoder();

export function bytes(value) {
  return typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value);
}

export function concatBytes(...parts) {
  const normalized = parts.map(bytes);
  const result = new Uint8Array(normalized.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of normalized) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32BigEndian(value) {
  return Uint8Array.of(
    value >>> 24,
    value >>> 16 & 0xff,
    value >>> 8 & 0xff,
    value & 0xff,
  );
}

function uint32LittleEndian(value) {
  return Uint8Array.of(
    value & 0xff,
    value >>> 8 & 0xff,
    value >>> 16 & 0xff,
    value >>> 24,
  );
}

function syncsafeUint28(value) {
  return Uint8Array.of(
    value >>> 21 & 0x7f,
    value >>> 14 & 0x7f,
    value >>> 7 & 0x7f,
    value & 0x7f,
  );
}

function pngChunk(type, data) {
  return concatBytes(uint32BigEndian(data.length), type, data, [0, 0, 0, 0]);
}

export function pngText(metadata) {
  const chunks = Object.entries(metadata).map(([key, value]) => (
    pngChunk("tEXt", concatBytes(key, [0], String(value)))
  ));
  return concatBytes(
    [137, 80, 78, 71, 13, 10, 26, 10],
    ...chunks,
    pngChunk("IEND", new Uint8Array()),
  );
}

export function gifComment(value) {
  const payload = bytes(value);
  const subBlocks = [];
  for (let offset = 0; offset < payload.length; offset += 255) {
    const part = payload.subarray(offset, offset + 255);
    subBlocks.push(Uint8Array.of(part.length), part);
  }
  return concatBytes(
    "GIF89a",
    [1, 0, 1, 0, 0, 0, 0],
    [0x21, 0xfe],
    ...subBlocks,
    [0, 0x3b],
  );
}

export function mp3Text(description, value) {
  const payload = concatBytes([3], description, [0], value);
  const frame = concatBytes("TXXX", uint32BigEndian(payload.length), [0, 0], payload);
  return concatBytes("ID3", [3, 0, 0], syncsafeUint28(frame.length), frame);
}

export function vorbisComments(entries, vendor = "Media Feed tests") {
  const comments = Object.entries(entries).map(([key, value]) => bytes(`${key}=${value}`));
  return concatBytes(
    uint32LittleEndian(bytes(vendor).length),
    vendor,
    uint32LittleEndian(comments.length),
    ...comments.flatMap((comment) => [uint32LittleEndian(comment.length), comment]),
  );
}

export function flacComments(entries) {
  const comments = vorbisComments(entries);
  return concatBytes(
    "fLaC",
    [0x84, comments.length >>> 16 & 0xff, comments.length >>> 8 & 0xff, comments.length & 0xff],
    comments,
  );
}

export function opusComments(entries) {
  const packet = concatBytes("OpusTags", vorbisComments(entries));
  if (packet.length > 255) throw new RangeError("Opus test comments must fit in one segment");
  return concatBytes(
    "OggS",
    new Uint8Array(22),
    [1, packet.length],
    packet,
  );
}

export function rangeResponse(body, total = bytes(body).length) {
  const data = bytes(body);
  return new Response(data, {
    status: 206,
    headers: {
      "Content-Length": String(data.length),
      "Content-Range": `bytes 0-${data.length - 1}/${total}`,
    },
  });
}

export const promptGraph = {
  1: {
    class_type: "KSampler",
    inputs: {
      seed: 123456,
      steps: 24,
      cfg: 7,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      positive: [2, 0],
      negative: [3, 0],
      model: [4, 0],
    },
  },
  2: {
    class_type: "CLIPTextEncode",
    inputs: { text: "a red fox", clip: [4, 1] },
  },
  3: {
    class_type: "CLIPTextEncode",
    inputs: { text: "blurry", clip: [4, 1] },
  },
  4: {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "models/example.safetensors" },
  },
};

export const workflowGraph = {
  nodes: [
    {
      id: 1,
      type: "KSampler",
      inputs: [
        { name: "model", link: 10 },
        { name: "positive", link: 11 },
        { name: "negative", link: 12 },
        { name: "seed", widget: { name: "seed" } },
      ],
      widgets_values: [654321],
    },
    {
      id: 2,
      type: "CLIPTextEncode",
      inputs: [{ name: "clip", link: 13 }],
      widgets_values: ["a blue bird"],
    },
    {
      id: 3,
      type: "CLIPTextEncode",
      inputs: [{ name: "clip", link: 14 }],
      widgets_values: ["low quality"],
    },
    {
      id: 4,
      type: "CheckpointLoaderSimple",
      inputs: [],
      widgets_values: ["models/workflow.safetensors"],
    },
  ],
  links: [
    [10, 4, 0, 1, 0, "MODEL"],
    [11, 2, 0, 1, 1, "CONDITIONING"],
    [12, 3, 0, 1, 2, "CONDITIONING"],
    [13, 4, 1, 2, 0, "CLIP"],
    [14, 4, 1, 3, 0, "CLIP"],
  ],
};
