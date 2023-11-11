import { log } from './Report.js'
import { type SAF } from './SAF.js'

export interface Term {
  showtext: string
  id: string
  trait: string
  scopetag: string
  vsntag: string
}

/**
 * The Interpreter class handles the interpretation of a term reference.
 * This interpretation happens according to a string that is supplied in `regex`.
 * A term is interpreted by calling the `interpret` method with the corresponding match.
 * The `interpret` method returns a map of the term properties.
 */
export class Interpreter {
  private readonly type: string
  private readonly regex: RegExp

  public constructor ({ regex }: { regex: string }) {
    const map: Record<string, RegExp> = {
      alt: /(?:(?<=[^`\\])|^)\[(?=[^@\]]+@[:a-z0-9_-]*\](?:\([#a-z0-9_-]+\))?)(?<showtext>[^\n\]@]+?)@(?<scopetag>[a-z0-9_-]*)(?::(?<vsntag>[a-z0-9_-]+?))?\](?:\((?<id>[a-z0-9_-]*)(?:#(?<trait>[a-z0-9_-]+?))?\))/g,
      basic: /(?:(?<=[^`\\])|^)\[(?=[^@\]]+\]\([#a-z0-9_-]*@[:a-z0-9_-]*\))(?<showtext>[^\n\]@]+)\]\((?:(?<id>[a-z0-9_-]*)?(?:#(?<trait>[a-z0-9_-]+))?)?@(?<scopetag>[a-z0-9_-]*)(?::(?<vsntag>[a-z0-9_-]+))?\)/g
    }

    const key = regex.toString().toLowerCase()
    const exist = Object.prototype.hasOwnProperty.call(map, key)
    // Check if the regex parameter is a key in the defaults map
    if (exist) {
      this.type = key
      this.regex = map[key]
    } else {
      this.type = 'custom'
      // Remove leading and trailing slashes, and flags
      this.regex = new RegExp(regex.replace(/^\/|\/[a-z]*$/g, ''), 'g')
    }
    log.info(`Using ${this.type} interpreter: '${this.regex}'`)
  }

  getRegex (): RegExp {
    return this.regex
  }

  interpret (match: RegExpMatchArray, saf: SAF): Term {
    // added as feedback from Michiel, should not happen as it would not be a match if there are no groups
    if (match.groups === undefined) {
      throw new Error('Error in evaluating regex pattern. No groups provided')
    }

    return {
      showtext: match.groups.showtext,
      id: match.groups.id?.length > 0 ? match.groups.id : match.groups.showtext.toLowerCase().replace(/['()]+/g, '').replace(/[^a-z0-9_-]+/g, '-'),
      trait: match.groups.trait,
      scopetag: match.groups.scopetag?.length > 0 ? match.groups.scopetag : saf.scope.scopetag,
      vsntag: match.groups.vsntag
    }
  }

  getType (): string {
    return this.type
  }
}