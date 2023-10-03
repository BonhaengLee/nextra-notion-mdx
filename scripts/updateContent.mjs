import dotenv from "dotenv";
dotenv.config();
import fs from "fs";
import path from "path";
import { NotionToMarkdown } from "notion-to-md";
import { Client } from "@notionhq/client";
import { fileURLToPath } from "url";
import { dirname } from "path";

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

const n2m = new NotionToMarkdown({ notionClient: notion });

export async function fetchPages() {
  return notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: "Status",
      status: {
        equals: "Published",
      },
    },
    sorts: [
      {
        property: "Created time",
        direction: "ascending",
      },
    ],
  });
}

export async function fetchPageBlocks(pageId) {
  const response = await notion.blocks.children.list({ block_id: pageId });
  return response.results;
}

async function updateContent() {
  const pages = await fetchPages();
  const pageResults = pages.results.entries();

  for (const [index, page] of pageResults) {
    const blocks = await fetchPageBlocks(page.id);
    const markdownObjects = await n2m.blocksToMarkdown(blocks);
    const markdownString = n2m.toMarkdownString(markdownObjects); // Convert Markdown objects to string

    // Ensure the page has a 'Slug' property
    const slug = page.properties["Slug"]["url"];
    const isSlug = !!slug;
    if (!isSlug) {
      console.error(`Page ${page.id} does not have a Slug property`);
      continue;
    }

    const pageTitle = page.properties["Title"]["title"][0]["plain_text"];
    const isPageTitle = !!pageTitle;
    if (!isPageTitle) {
      console.error(`Page ${page.id} does not have a pageTitle property`);
      continue;
    }

    const markdownTitle = `# ${pageTitle}\n\n`;
    const fullMarkdownContent = markdownTitle + markdownString.parent;

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    let folderPath;
    let slugParts;
    if (page.properties["Tab"]) {
      const tabName = page.properties["Tab"]["select"]["name"];
      slugParts = slug.split("/");
      folderPath = path.join(
        __dirname,
        "../pages",
        tabName,
        ...slugParts.slice(0, -1)
      );

      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
    } else {
      slugParts = slug.split("/");
      folderPath = path.join(__dirname, "../pages", ...slugParts.slice(0, -1));
    }

    const fileIndex = index + 1;
    const fileName = `${fileIndex}.-${slugParts[slugParts.length - 1]}.mdx`;

    fs.writeFileSync(path.join(folderPath, fileName), fullMarkdownContent);
  }
}

updateContent();
