import { Component, ElementRef, inject, input } from '@angular/core';
import type { BoxStyle, Boxes } from 'cli-boxes';
import type { InkNode } from '../tree/node';
import {
  definedProps,
  optionalBoolean,
  optionalNumber,
  sizeAttribute,
  type InkSize,
} from './attributes';

/** A named style from cli-boxes, or the eight characters of a custom one. */
type BorderStyle = keyof Boxes | BoxStyle;

@Component({
  selector: 'ink-box',
  template: '<ng-content />',
})
export class InkBox {
  readonly position = input<'relative' | 'absolute' | 'static' | undefined>();
  readonly top = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly right = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly bottom = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly left = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly columnGap = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly rowGap = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly gap = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly margin = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly marginX = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly marginY = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly marginTop = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly marginBottom = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly marginLeft = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly marginRight = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly padding = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly paddingX = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly paddingY = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly paddingTop = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly paddingBottom = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly paddingLeft = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly paddingRight = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly flexGrow = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly flexShrink = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly flexDirection = input<'row' | 'column' | 'row-reverse' | 'column-reverse' | undefined>();
  readonly flexBasis = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly flexWrap = input<'nowrap' | 'wrap' | 'wrap-reverse' | undefined>();
  readonly alignItems = input<
    'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline' | undefined
  >();
  readonly alignSelf = input<
    'auto' | 'flex-start' | 'center' | 'flex-end' | 'stretch' | 'baseline' | undefined
  >();
  readonly alignContent = input<
    | 'flex-start'
    | 'flex-end'
    | 'center'
    | 'stretch'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | undefined
  >();
  readonly justifyContent = input<
    | 'flex-start'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly'
    | 'center'
    | undefined
  >();
  readonly width = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly height = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly minWidth = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly minHeight = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly maxWidth = input<number | undefined, unknown>(undefined, { transform: optionalNumber });
  readonly maxHeight = input<InkSize | undefined, unknown>(undefined, { transform: sizeAttribute });
  readonly aspectRatio = input<number | undefined, unknown>(undefined, {
    transform: optionalNumber,
  });
  readonly display = input<'flex' | 'none' | undefined>();
  readonly overflow = input<'visible' | 'hidden' | undefined>();
  readonly overflowX = input<'visible' | 'hidden' | undefined>();
  readonly overflowY = input<'visible' | 'hidden' | undefined>();
  readonly backgroundColor = input<string | undefined>();
  readonly borderStyle = input<BorderStyle | undefined>();
  readonly borderTop = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderBottom = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderLeft = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderRight = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderColor = input<string | undefined>();
  readonly borderTopColor = input<string | undefined>();
  readonly borderBottomColor = input<string | undefined>();
  readonly borderLeftColor = input<string | undefined>();
  readonly borderRightColor = input<string | undefined>();
  readonly borderDimColor = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderTopDimColor = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderBottomDimColor = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderLeftDimColor = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderRightDimColor = input<boolean | undefined, unknown>(undefined, {
    transform: optionalBoolean,
  });
  readonly borderBackgroundColor = input<string | undefined>();
  readonly borderTopBackgroundColor = input<string | undefined>();
  readonly borderBottomBackgroundColor = input<string | undefined>();
  readonly borderLeftBackgroundColor = input<string | undefined>();
  readonly borderRightBackgroundColor = input<string | undefined>();

  constructor() {
    (inject(ElementRef).nativeElement as InkNode).owner = this;
  }

  /** The styles that were set; the engine maps them to Yoga and to painting. */
  inkProps(): Record<string, unknown> {
    return definedProps({
      position: this.position,
      top: this.top,
      right: this.right,
      bottom: this.bottom,
      left: this.left,
      columnGap: this.columnGap,
      rowGap: this.rowGap,
      gap: this.gap,
      margin: this.margin,
      marginX: this.marginX,
      marginY: this.marginY,
      marginTop: this.marginTop,
      marginBottom: this.marginBottom,
      marginLeft: this.marginLeft,
      marginRight: this.marginRight,
      padding: this.padding,
      paddingX: this.paddingX,
      paddingY: this.paddingY,
      paddingTop: this.paddingTop,
      paddingBottom: this.paddingBottom,
      paddingLeft: this.paddingLeft,
      paddingRight: this.paddingRight,
      flexGrow: this.flexGrow,
      flexShrink: this.flexShrink,
      flexDirection: this.flexDirection,
      flexBasis: this.flexBasis,
      flexWrap: this.flexWrap,
      alignItems: this.alignItems,
      alignSelf: this.alignSelf,
      alignContent: this.alignContent,
      justifyContent: this.justifyContent,
      width: this.width,
      height: this.height,
      minWidth: this.minWidth,
      minHeight: this.minHeight,
      maxWidth: this.maxWidth,
      maxHeight: this.maxHeight,
      aspectRatio: this.aspectRatio,
      display: this.display,
      overflow: this.overflow,
      overflowX: this.overflowX,
      overflowY: this.overflowY,
      backgroundColor: this.backgroundColor,
      borderStyle: this.borderStyle,
      borderTop: this.borderTop,
      borderBottom: this.borderBottom,
      borderLeft: this.borderLeft,
      borderRight: this.borderRight,
      borderColor: this.borderColor,
      borderTopColor: this.borderTopColor,
      borderBottomColor: this.borderBottomColor,
      borderLeftColor: this.borderLeftColor,
      borderRightColor: this.borderRightColor,
      borderDimColor: this.borderDimColor,
      borderTopDimColor: this.borderTopDimColor,
      borderBottomDimColor: this.borderBottomDimColor,
      borderLeftDimColor: this.borderLeftDimColor,
      borderRightDimColor: this.borderRightDimColor,
      borderBackgroundColor: this.borderBackgroundColor,
      borderTopBackgroundColor: this.borderTopBackgroundColor,
      borderBottomBackgroundColor: this.borderBottomBackgroundColor,
      borderLeftBackgroundColor: this.borderLeftBackgroundColor,
      borderRightBackgroundColor: this.borderRightBackgroundColor,
    });
  }
}
