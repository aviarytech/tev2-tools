import { log } from "./Report.js"
import { generator } from "./Run.js"

import matter from "gray-matter"
import fs = require("fs")
import path = require("path")
import { type MRG, type Entry, type Terminology, MrgBuilder } from "./MRG.js"
import { type Version, type Scopes } from "./SAF.js"

export class TuC {
  public entries: Entry[] = []
  public scopes = new Set<Scopes>()
  public terminology = {} as Terminology
  public filename: string
  public cText = false

  static instances: TuC[] = []
  static cTextMap: Entry[] = []
  static synonymOf: Entry[] = []

  public constructor({ vsn }: { vsn: Version }) {
    if (!vsn.termselection) {
      log.warn(`\tNo 'termselection' items found for '${vsn.vsntag}'`)
    } else {
      this.getTuCMap(vsn.termselection)
    }

    // set relevant fields in the terminology section
    this.terminology = {
      scopetag: generator.saf.scope.scopetag,
      scopedir: generator.saf.scope.scopedir,
      curatedir: generator.saf.scope.curatedir,
      vsntag: vsn.vsntag,
      altvsntags: vsn.altvsntags
    }

    this.filename = `mrg.${this.terminology.scopetag}.${this.terminology.vsntag}.yaml`

    // set fields in the scopes section
    for (const scope of this.scopes) {
      // Check if a scope with the same scopetag already exists in this.scopes
      const existingScope = [...this.scopes].filter((s) => s.scopetag === scope.scopetag)

      if (existingScope?.length > 1) {
        // If an existing scope is found, delete it
        this.scopes.delete(scope)
        continue
      }
      // find the corresponding scope in the SAF's scope section
      const SAFscope = generator.saf.scopes?.find((SAFscope) => SAFscope.scopetag === scope.scopetag)
      if (SAFscope) {
        scope.scopedir = SAFscope.scopedir
      } else {
        this.scopes.delete(scope)
      }
    }

    TuC.instances.push(this)
  }

  public getTuCMap(instructions: string[]): Entry[] {
    instructions?.forEach((instruction) => {
      if (instruction.startsWith("-")) {
        // Execute removal
        this.removeMrgEntry(instruction.slice(1)) // Remove the leading '-'
      } else if (instruction.startsWith("rename ")) {
        // Execute rename
        this.renameMrgEntry(instruction.slice(7)) // Remove the leading 'rename '
      } else {
        // Execute addition or selection
        this.addMrgEntry(instruction)
      }
    })

    return this.entries
  }

  public output(): MRG {
    // create the MRG using terminology, scopes and entries and sort the entries by term
    const mrg = {
      terminology: this.terminology,
      scopes: Array.from(this.scopes),
      entries: this.entries.sort((a, b) => a.term.localeCompare(b.term))
    }

    return mrg as MRG
  }

  private getCtextEntries(): Entry[] {
    // signal use of curated texts
    this.cText = true
    // return cTextMap if it already exists
    if (TuC.cTextMap.length > 0) {
      return TuC.cTextMap
    }
    const curatedir = path.join(generator.saf.scope.localscopedir, generator.saf.scope.curatedir)

    // Get all the curated texts from the curatedir and their subdirectories
    let curatedirContent = []
    const walkSync = (dir: string, filelist: string[] = []) => {
      fs.readdirSync(dir).forEach((file) => {
        filelist = fs.statSync(path.join(dir, file)).isDirectory()
          ? walkSync(path.join(dir, file), filelist)
          : filelist.concat(path.join(dir, file))
      })
      return filelist
    }
    curatedirContent = walkSync(curatedir)

    // Interpret all the curated texts and store them in the terminology under construction
    const ctexts = curatedirContent.filter((ctext) => ctext.endsWith(".md"))

    // load properties of curated texts as MRG Entry
    ctexts?.forEach((ctext) => {
      const ctextPath = ctext
      ctext = path.relative(curatedir, ctext)

      const ctextFile = matter(fs.readFileSync(ctextPath, "utf8"))
      let body = ctextFile.content

      const ctextYAML = ctextFile.data as Entry

      // remove properties that match specific set of predetermined properties
      Object.keys(ctextYAML).forEach((key) => {
        if (["scopetag", "locator", "navurl", "headingids"].includes(key.toLowerCase())) {
          delete ctextYAML[key]
        }
      })

      // construct navurl from website, navpath and ctext name, or bodyFile
      const navUrl = new URL(generator.saf.scope.website)
      const pathname = navUrl.pathname
      if (ctextYAML.bodyFile) {
        // If the bodyFile property is set, then use that to construct the navurl
        const bodyFilePath = path.parse(ctextYAML.bodyFile)
        navUrl.pathname = path.join(pathname, bodyFilePath.dir, bodyFilePath.name)
        try {
          const bodyFile = matter(
            fs.readFileSync(path.join(generator.saf.scope.localscopedir, ctextYAML.bodyFile), "utf8")
          )
          body = bodyFile.content

          // if the bodyFile has a `bodyFileID` property, then use that to construct the navurl
          if (generator.saf.scope.bodyFileID) {
            if (bodyFile.data[generator.saf.scope.bodyFileID]) {
              navUrl.pathname = path.join(
                pathname,
                bodyFilePath.dir,
                path.parse(bodyFile.data[generator.saf.scope.bodyFileID]).name
              )
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            log.error(`\tAn error occurred while attempting to load the bodyFile '${ctextYAML.bodyFile}':`, err.message)
          }
        }
      } else {
        navUrl.pathname = path.join(
          pathname,
          generator.saf.scope.navpath,
          path.parse(ctext).dir,
          path.parse(ctext).name
        )
      }

      // Extract heading IDs from markdown content
      const headingIds = extractHeadingIds(body)

      // add properties to MRG Entry
      ctextYAML.scopetag = generator.saf.scope.scopetag
      ctextYAML.locator = ctext
      ctextYAML.navurl = navUrl.href
      ctextYAML.headingids = headingIds

      if (ctextYAML.synonymOf) {
        TuC.synonymOf.push(ctextYAML)
      }
      TuC.cTextMap.push(ctextYAML)
    })
    return TuC.cTextMap
  }

  private addMrgEntry(instruction: string): void {
    const regex =
      /^(?<key>[^[@]+)(?:\[(?<values>.+?)?\])?(?:(?<identifier>@)(?<scopetag>[a-z0-9_-]+?)?)?(?::(?<vsntag>.+)?)?$/
    const match = instruction.replace(/\s/g, "").match(regex)

    if (!match) {
      log.error(`\tE021 Invalid instruction: '${instruction}'`)
      return undefined
    }

    const { key, values, identifier, scopetag, vsntag } = match.groups!
    let entries: Entry[]
    let source = ``

    const valuelist = values?.split(",").map((v) => v.trim())
    instruction = `${key}${key !== "*" ? "[" + valuelist?.join(", ") + "]" : ""}${
      identifier ? "@" + scopetag + (vsntag ? ":" + vsntag : "") : ""
    }`

    try {
      if (!identifier) {
        // add all terms for which there are curated texts in the current scope
        source = `curated texts`
        entries = this.getCtextEntries()
      } else {
        // add all terms in the MRG for either the current or the specified scope and version
        const mrgFile = `mrg.${scopetag ?? generator.saf.scope.scopetag}.${vsntag ? vsntag + "." : ""}yaml`
        source = `'${mrgFile}'`

        const mrgMap =
          MrgBuilder.instances?.find((mrg) => mrg.filename === mrgFile) ?? new MrgBuilder({ filename: mrgFile }).mrg
        entries = mrgMap.entries
      }

      if (key !== "*") {
        entries = entries.filter((entry) => {
          // if the entry has a field with the same name as the key
          if (entry[key] !== undefined) {
            // and both the values list and key entry property is empty
            if (!values && (entry[key] === "" || entry[key] === null)) {
              return true // then include the entry
            } else if (!values) {
              // if the values list is empty
              return false // then exclude the entry
            }
            // or the value of that field is in the values list
            for (const value of valuelist) {
              if (typeof entry[key] === "string") {
                // if the entry[key] is a string
                if (entry[key] === value) {
                  return true // then include the entry
                }
              } else {
                if ((entry[key] as string[])?.includes(value)) {
                  // if the entry[key] is an array
                  return true // then include the entry
                }
              }
            }
          }
          // else, exclude the entry
          return false
        })
      }

      log.info(`\tTermselection (${source}): \t'${instruction}'`)

      if (entries.length > 0) {
        // add entries to TuC and overwrite existing entries with the same term
        for (const newEntry of entries) {
          const existingIndex = this.entries.findIndex((entry) => entry.term === newEntry.term)
          if (existingIndex !== -1) {
            // If an entry with the same term already exists, replace it with the new entry
            this.entries[existingIndex] = { ...newEntry } // Create a shallow copy of the new entry
          } else {
            // If no entry with the same term exists, add a shallow copy of the new entry to this.entries
            this.entries.push({ ...newEntry }) // Create a shallow copy of the new entry
          }
        }

        this.scopes.add({
          scopetag: scopetag,
          scopedir: ""
        })

        if (key !== "*") {
          log.trace(
            `\t\tAdded ${entries.length} entr${entries.length > 1 ? "ies" : "y"}: ${entries
              .map((entry) => entry.term)
              .join(", ")}`
          )

          //  Report valueList items that did not match any entries
          if (valuelist) {
            const unmatchedValues = valuelist.filter((value) => !entries.some((entry) => entry[key] === value))
            if (unmatchedValues.length > 0) {
              log.warn(`\t\tCould not match: ${key}[${unmatchedValues.join(", ")}]`)
            }
          }
        } else {
          log.trace(`\t\tAdded ${entries.length} entr${entries.length > 1 ? "ies" : "y"} from ${source}`)
        }
      } else {
        log.warn(`\t\tSelection matched 0 entries`)
      }
    } catch (err) {
      if (err instanceof Error) {
        log.info(`\tTermselection (${source}): \t'${instruction}'`)
        log.error(`\t\tInstruction caused an error: ${err.message}`)
      }
    }
  }

  private removeMrgEntry(instruction: string): void {
    const regex = /^(?<key>[^[]+)(?:\[(?<values>.+?)?\])?$/
    const match = instruction.replace(/\s/g, "").match(regex)

    if (!match) {
      log.error(`\tE021 Invalid instruction: '-${instruction}'`)
      return undefined
    }

    const { key, values } = match.groups!
    const removed: Entry[] = []
    const valuelist = values?.split(",").map((v) => v.trim())
    instruction = `-${key}[${valuelist ? valuelist.join(", ") : ""}]`

    try {
      this.entries = this.entries.filter((entry) => {
        // if the entry has a field with the same name as the key
        if (entry[key] !== undefined) {
          // and both the values list and key entry property is empty
          if (!values && (entry[key] === "" || entry[key] === null)) {
            removed.push(entry)
            return false
          } else if (!values) {
            return true
          }
          // or the value of that field is in the value list
          for (const value of valuelist) {
            if (typeof entry[key] === "string") {
              // if the entry[key] is a string
              if (entry[key] === value) {
                removed.push(entry)
                return false // then exclude the entry
              }
            } else {
              if ((entry[key] as string[]).includes(value)) {
                // if the entry[key] is an array
                removed.push(entry)
                return true // then exclude the entry
              }
            }
          }
        }
        // else, keep the entry
        return true
      })

      log.info(`\tTermselection (provisional): \t'${instruction}'`)
      if (removed.length === 0) {
        // log warning if no entries were removed
        log.warn(`\t\tSelection matched 0 terms`)
      } else {
        log.trace(
          `\t\tRemoved ${removed.length} entr${removed.length > 1 ? "ies" : "y"}: ${removed
            .map((entry) => entry.term)
            .join(", ")}`
        )
        // report valueList items that did not match any entries
        if (valuelist) {
          const unmatchedValues = valuelist.filter((value) => !removed.some((entry) => entry[key] === value))
          if (unmatchedValues.length > 0) {
            log.warn(`\t\tCould not match: -${key}[${unmatchedValues.join(", ")}]`)
          }
        }
      }
    } catch (err) {
      if (err instanceof Error) {
        log.info(`\tTermselection (provisional): \t'${instruction}'`)
        log.error(`\t\tInstruction caused an error: ${err.message}`)
      }
    }
  }

  private renameMrgEntry(instruction: string): void {
    const regex = /^(?<term>[^[]+)(?:\[(?<fieldmodifierlist>.+?)?\])?$/
    const match = instruction.match(regex)

    if (!match) {
      log.error(`\tE021 Invalid instruction: 'rename ${instruction}'`)
      return undefined
    }

    const fieldmodifierlist = match.groups!.fieldmodifierlist
    const term = match.groups!.term.trim()
    const fieldModifiers: Record<string, unknown> = {} // Initialize an object for field modifiers
    const modifierString: string[] = []

    try {
      if (fieldmodifierlist) {
        // Use a regular expression to capture the key-value pairs in the fieldmodifierlist
        const keyValueRegex = /[\s,]*([^:]+)\s*:\s*((["'`])(.*?)\3|[^,]+)\s*/g
        let keyValueMatch

        // Extract the key-value pairs from the field modifier list
        while ((keyValueMatch = keyValueRegex.exec(fieldmodifierlist))) {
          // remove leading and trailing whitespace
          const key = keyValueMatch[1]
          const value = keyValueMatch[4] ?? keyValueMatch[2]
          fieldModifiers[key] = value
          modifierString.push(`${key}: ${value}`)
        }
        instruction = `rename ${term} [${modifierString?.join(", ")}]`
      }

      // Find the entries with the term
      const entries = this.entries.filter((entry) => entry.term === term)
      const renamed: string[] = []

      if (entries?.length > 0) {
        // Modify the entry based on the field modifiers
        for (const entry of entries) {
          renamed.push(entry.term)
          for (const [key, value] of Object.entries(fieldModifiers)) {
            entry[key] = value
          }
        }
      }

      log.info(`\tTermselection (provisional): \t'${instruction}'`)
      if (renamed.length === 0) {
        log.warn(`\t\tSelection matched 0 entries`)
      } else {
        log.trace(`\t\tRenamed ${renamed.length} entr${renamed.length > 1 ? "ies" : "y"}: ${renamed.join(", ")}`)
      }
    } catch (err) {
      if (err instanceof Error) {
        log.info(`\tTermselection (provisional): \t'${instruction}'`)
        log.error(`\t\tInstruction caused an error: ${err.message}`)
      }
    }
  }
}

/**
 * Extracts the heading IDs from the markdown content.
 * @param content The markdown content.
 * @returns An array of heading IDs.
 */
function extractHeadingIds(content: string): string[] {
  // Regular expression to match markdown headings
  const headingRegex = /^#+\s+(.*)$/gm

  let matches
  const headingIds: string[] = []

  while ((matches = headingRegex.exec(content)) !== null) {
    const headingId = matches[1].replace(/\s+/g, "-").toLowerCase()
    headingIds.push(headingId)
  }

  return headingIds
}
