#!/usr/bin/env node

import { Interpreter } from "./Interpreter.js"
import { Converter } from "./Converter.js"
import { SafBuilder } from "@tno-terminology-design/utils"
import { Resolver } from "./Resolver.js"
import { Command, type OptionValues } from "commander"
import { readFileSync } from "fs"
import { resolve } from "path"
import { report, log } from "@tno-terminology-design/utils"

import yaml from "js-yaml"
import chalk from "chalk"
import figlet from "figlet"

export let resolver: Resolver
const program = new Command()

program
  .name("trrt")
  .version("1.0.11")
  .usage(
    "[ <paramlist> ] [ <globpattern> ]\n" +
      "- <paramlist> (optional) is a list of key-value pairs\n" +
      "- <globpattern> (optional) specifies a set of (input) files that are to be processed"
  )
  .description("The CLI for the Term Reference Resolution Tool")
  .option("-c, --config <path>", "Path (including the filename) of the tool's (YAML) configuration file")
  .option("-o, --output <dir>", "(Root) directory for output files to be written")
  .option("-s, --scopedir <path>", "Path of the scope directory where the SAF is located")
  // If interpreters or converters are added/removed, please adjust the documentation in the repo-file `tno-terminology-design/tev2-specifications/docs/spec-files/90-configuration-file.md`.
  .option(
    "-int, --interpreter <regex> or <predeftype>",
    "Type of interpreter, i.e., a regex, or a predefined type (`default`, `alt`)"
  ) // `basic` is deprecated
  .option(
    "-con, --converter <template> or <predeftype>",
    "Type of converter, i.e., a mustache/handlebars template, or a predefined type (`markdown-link`, `html-link`, `html-hovertext-link`, `html-glossarytext-link`)"
  )
  .option("-f, --force", "Allow overwriting of existing files")
  .parse(process.argv)

program.parse()

async function main(): Promise<void> {
  try {
    // Parse command line parameters
    let options = program.opts()
    if (program.args[0] != null) {
      options.input = program.args[0]
    }

    console.log(chalk.red(figlet.textSync("trrt-cli", { horizontalLayout: "full" })))

    if (options.config != null) {
      try {
        const config = yaml.load(readFileSync(resolve(options.config), "utf8")) as OptionValues

        // Overwrite command line options with config options and trrt specific config options
        const { trrt, ...rest } = config
        options = { ...rest, ...trrt, ...options }
      } catch (err) {
        throw new Error(`E011 Failed to read or parse the config file '${options.config}':`, { cause: err })
      }
    }

    // Check if required options are provided
    if (options.output == null || options.scopedir == null || options.input == null) {
      program.addHelpText(
        "after",
        "\nRequired options are missing\n" +
          "Provide at least the following options: output <path>, scopedir <path> and input <globpattern>\n"
      )
      program.help()
      process.exit(1)
    } else {
      // Create an interpreter, converter and glossary with the provided options
      const interpreter = new Interpreter({ regex: options.interpreter ?? "default" })
      const converter = new Converter({ template: options.converter ?? "markdown" })
      const saf = new SafBuilder({ scopedir: resolve(options.scopedir) }).saf

      // Create a resolver with the provided options
      resolver = new Resolver({
        outputPath: resolve(options.output),
        globPattern: options.input,
        force: options.force,
        interpreter,
        converter,
        saf
      })

      // Resolve terms
      await resolver.resolve()
      log.info("Resolution complete...")
      report.print()
      process.exit(0)
    }
  } catch (err) {
    if ((err as Error).cause != null) {
      log.error(err)
      process.exit(1)
    } else {
      log.error("E012 Something unexpected went wrong while resoluting terms:", err)
      process.exit(1)
    }
  }
}

await main()
