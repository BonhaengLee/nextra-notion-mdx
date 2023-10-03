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
  });
}

export async function fetchIndexPages() {
  return notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: "Status",
      status: {
        equals: "Index",
      },
    },
  });
}

export async function fetchPageBlocks(pageId) {
  const response = await notion.blocks.children.list({ block_id: pageId });
  return response.results;
}

function getSlugParts(slug) {
  return slug.split("/");
}

async function getFolderPath(page, __dirname, slug) {
  const slugParts = getSlugParts(slug);
  const subpathOfTab = slugParts.slice(0, -1);
  let folderPath;

  if (page.properties["Tab"]) {
    const tabName = page.properties["Tab"]?.["select"]?.["name"];
    folderPath = path.join(__dirname, "../pages", tabName, ...subpathOfTab);
  } else {
    folderPath = path.join(__dirname, "../pages", ...subpathOfTab);
  }
  await fs.promises.mkdir(folderPath, { recursive: true });

  return [folderPath, slugParts[slugParts.length - 1]];
}

async function writeMetaJsonFile(folderPath, originFileName, plainText) {
  try {
    const parsedData = JSON.parse(plainText);
    const formattedJson = JSON.stringify(parsedData, null, 2);
    await fs.promises.writeFile(
      path.join(`${folderPath}/${originFileName}`, "_meta.json"),
      formattedJson
    );
  } catch (error) {
    console.error(`Failed to write _meta.json file:`, error);
  }
}

async function writeMarkdownFile(
  folderPath,
  originFileName,
  pageTitle,
  markdownString
) {
  try {
    const markdownTitle = `# ${pageTitle}\n\n`;
    const fullMarkdownContent = markdownTitle + markdownString.parent;
    const mdxFileName = `${originFileName}.mdx`;
    await fs.promises.writeFile(
      path.join(folderPath, mdxFileName),
      fullMarkdownContent
    );
  } catch (error) {
    console.error(`Failed to write .mdx file:`, error);
  }
}

async function updateContent() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Convert Indexes
  const indexPages = await fetchIndexPages();
  const indexPageResults = Object.entries(indexPages.results);

  const indexPagePromises = indexPageResults.map(async ([idx, indexPage]) => {
    const blocks = await fetchPageBlocks(indexPage.id);
    if (!blocks[0]?.code?.rich_text) {
      console.error(`Invalid data structure for indexPage ${idx}`);
      return;
    }

    console.time(`indexPagePromises-${idx}`);

    try {
      const plainText = blocks[0].code.rich_text[0].plain_text;
      const slug = indexPage.properties["Slug"]?.url;
      if (!slug) {
        throw new Error(
          `indexPage ${indexPage.id} does not have a Slug property`
        );
      }

      const [folderPath, originFileName] = await getFolderPath(
        indexPage,
        __dirname,
        slug
      );
      await writeMetaJsonFile(folderPath, originFileName, plainText);
      console.timeEnd(`indexPagePromises-${idx}`);
    } catch (error) {
      console.error(`Failed to process indexPage ${idx}:`, error);
    }
  });

  await Promise.all(indexPagePromises);

  // Convert Pages
  const pages = await fetchPages();
  const pageResults = Object.entries(pages.results);

  const pagePromises = pageResults.map(([index, page]) => {
    return fetchPageBlocks(page.id)
      .then(blocks => n2m.blocksToMarkdown(blocks))
      .then(markdownObjects => n2m.toMarkdownString(markdownObjects))
      .then(async markdownString => {
        console.time(`pagePromises-${index}`);

        const slug = page.properties["Slug"]?.["url"];
        const isSlug = !!slug;
        if (!isSlug) {
          throw new Error(`Page ${page.id} does not have a Slug property`);
        }

        const pageTitle =
          page.properties["Title"]?.["title"]?.[0]?.["plain_text"];
        const isPageTitle = !!pageTitle;
        if (!isPageTitle) {
          throw new Error(`Page ${page.id} does not have a pageTitle property`);
        }

        const [folderPath, originFileName] = await getFolderPath(
          page,
          __dirname,
          slug
        );

        await writeMarkdownFile(
          folderPath,
          originFileName,
          pageTitle,
          markdownString
        );
        console.timeEnd(`pagePromises-${index}`);
      });
  });

  await Promise.all(pagePromises);
}
console.time("updateContent");
await updateContent();
console.timeEnd("updateContent");
