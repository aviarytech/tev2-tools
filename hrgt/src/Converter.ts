import Handlebars, { type HelperOptions } from "handlebars"
import { log } from "@tno-terminology-design/utils"
import { type Entry } from "@tno-terminology-design/utils"
import { type MRGRef } from "./Interpreter.js"

export class Converter {
  private readonly type: string
  private readonly template: string

  public constructor({ template }: { template: string }) {
    // map of default templates for each type
    const map: Record<string, string> = {
      markdowntable: "| {{glossaryTerm}} | {{glossaryText}} |",
      essiflab: ""
    }

    // register helper functions with Handlebars
    Handlebars.registerHelper("capFirst", capFirstHelper)
    Handlebars.registerHelper("ifValue", ifValueHelper)

    const key = template.toLowerCase()
    const exist = Object.prototype.hasOwnProperty.call(map, key)
    // check if the template parameter is a key in the defaults map
    if (exist) {
      this.type = key
      this.template = map[key]
    } else {
      this.type = "custom"
      this.template = template
    }
    log.info(`Using ${this.type} template: '${this.template}'`)
  }

  convert(entry: Entry, mrgref: MRGRef): string {
    const template = Handlebars.compile(this.template, { noEscape: true, compat: true })

    return template({ ...entry, ...mrgref })
  }

  getType(): string {
    return this.type
  }
}

/**
 * Helper function to capitalize the first letter of every word in a string
 * @param text - The string to be capitalized
 * @returns The capitalized string
 */
function capFirstHelper(text: string): string {
  if (Handlebars.Utils.isEmpty(text)) {
    return text
  }

  // the first character of every word separated by spaces will be capitalized
  const words = text.split(" ")
  const capitalizedWords = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return capitalizedWords.join(" ")
}

/**
 * Helper function to compare two values in a Handlebars `ifValue` block
 * @param conditional - The first value to compare
 * @param options - The second value to compare
 * @returns The result of the comparison
 */
function ifValueHelper(this: unknown, conditional: unknown, options: HelperOptions): string {
  if (conditional === options.hash.equals) {
    return options.fn(this)
  } else {
    return options.inverse(this)
  }
}