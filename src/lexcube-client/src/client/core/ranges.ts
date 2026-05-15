import { roundUpToSparsity, roundDownToSparsity } from '../constants';

function padDateElement(number: Number, amount: Number = 2) {
    return `00${number}`.slice(-amount);
}

export function getDayString(date: Date) {
    return `${padDateElement(date.getUTCDate())}.${padDateElement(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

export function getTimeString(date: Date, millisecondsDisplayed: boolean) {
    return `${padDateElement(date.getUTCHours())}:${padDateElement(date.getUTCMinutes())}:${padDateElement(date.getUTCSeconds())}${millisecondsDisplayed ? `:${padDateElement(date.getUTCMilliseconds(), 3)}` : ""}`;
}

export class GeospatialRange {
    private first: number;
    private last: number;
    ascending: boolean = true;
    min: number;
    max: number;

    constructor(first: number, last: number, overflowAllowed: boolean = false, overflowRange: number = 0) {
        this.first = first;
        this.last = last;
        if (this.first > this.last && overflowAllowed) {
            this.last += overflowRange;
        }
        this.min = Math.min(this.first, this.last);
        this.max = Math.max(this.first, this.last);
        this.ascending = this.first < this.last;
    }

    getFirst() {
        return this.first;
    }

    getLast() {
        return this.last;
    }

    range() {
        return Math.abs(this.last - this.first);
    }

    middle() {
        return this.first + (this.last - this.first) / 2;
    }

    setFromMinMaxAscending(min: number, max: number, ascending: boolean) {
        if (ascending) {
            this.first = min;
            this.last = max;
        } else {
            this.first = max;
            this.last = min;
        }
        this.ascending = ascending;
        this.min = Math.min(this.first, this.last);
        this.max = Math.max(this.first, this.last);
    }

    set(first: number, last: number) {
        this.first = first;
        this.last = last;
        this.ascending = first < last;
        this.min = Math.min(this.first, this.last);
        this.max = Math.max(this.first, this.last);
    }

    isValid() {
        return !isNaN(this.first) && !isNaN(this.last) && this.first != this.last;
    }

    relativeWithin(x: number) {
        return (x - this.min) / this.range();
    }

    getValueWithin(p: number) {
        if (this.ascending) {
            return this.getFirst() + p * this.range();
        } else {
            return this.getFirst() - p * this.range();
        }
    }

    toString() {
        return `${this.first}-${this.last}`;
    }
}

export class ParameterRange {
    min: number;
    max: number; // Upper bound is EXCLUSIVE

    private savedLength: number = 0; // for floating point precision issues
    private validateSize: boolean = false;
    static sparsity: number = 1;

    constructor(min: number = 0, max: number = 0, validateSize: boolean = false) {
        this.min = min;
        this.max = max;
        this.validateSize = validateSize;
    }

    public length() {
        if (this.savedLength > 0 && Math.abs(this.savedLength - (this.max - this.min)) < 1e-6) {
            return this.savedLength;
        }
        return this.max - this.min;
    }

    range() {
        return Math.abs((this.max) - this.min);
    }

    middle() {
        return this.min + ((this.max) - this.min) / 2;
    }

    public toString(roundedToSparsity: boolean = false) {
        const min = roundedToSparsity ? roundUpToSparsity(this.min, ParameterRange.sparsity) : this.min;
        const max = roundedToSparsity ? (roundDownToSparsity(this.max, ParameterRange.sparsity)) : this.max;
        return `${min}-${max}`;
    }

    subRangeOf(outerRange: ParameterRange, overflowAllowed: boolean = false) {
        if (overflowAllowed) {
            return this.min >= outerRange.min && this.max <= outerRange.max * 2;
        }
        return this.min >= outerRange.min && this.max <= outerRange.max;
    }

    copy(other: ParameterRange) {
        this.min = other.min;
        this.max = other.max;
        this.validateSize = other.validateSize;
        this.validate();
        return this;
    }

    set(min: number, max: number, finalChange: boolean = true, length: number = 0) {
        this.min = min;
        this.max = max;
        this.savedLength = length;
        if (finalChange) {
            this.validate();
        }
        return this;
    }

    static copyFrom(other: ParameterRange): ParameterRange {
        return new ParameterRange().copy(other);
    }

    clone(): ParameterRange {
        return new ParameterRange().copy(this);
    }

    equals(other: ParameterRange) {
        return this.min == other.min && this.max == other.max;
    }

    private validate() {
        if (!this.validateSize) {
            return;
        }
        const minValid = this.min % ParameterRange.sparsity == 0;
        const maxValid = (this.max - 1) % ParameterRange.sparsity == 0;
        if (!minValid || !maxValid) {
            throw new Error(`Invalid range ${this} for sparsity ${ParameterRange.sparsity}`);
        }
    }
}
