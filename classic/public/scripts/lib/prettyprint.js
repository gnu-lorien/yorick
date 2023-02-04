define(function () {
    "use strict";

    var pretty = function (jsObject, indentLength, outputTo, fullFunction) {
        var indentString,
            newLine,
            newLineJoin,
            TOSTRING,
            TYPES,
            valueType,
            repeatString,
            prettyObject,
            prettyObjectJSON,
            prettyObjectPrint,
            prettyArray,
            functionSignature,
            pretty,
            visited;

        TOSTRING = Object.prototype.toString;

        TYPES = {
            'undefined': 'undefined',
            'number': 'number',
            'boolean': 'boolean',
            'string': 'string',
            '[object Function]': 'function',
            '[object RegExp]': 'regexp',
            '[object Array]': 'array',
            '[object Date]': 'date',
            '[object Error]': 'error'
        };

        valueType = function (o) {
            var type = TYPES[typeof o] || TYPES[TOSTRING.call(o)] || (o ? 'object' : 'null');
            return type;
        };

        repeatString = function (src, length) {
            var dst = '',
                index;
            for (index = 0; index < length; index += 1) {
                dst += src;
            }

            return dst;
        };

        prettyObjectJSON = function (object, indent) {
            var value = [],
                property;

            indent += indentString;
            for (property in object) {
                if (object.hasOwnProperty(property)) {
                    value.push(indent + '"' + property + '": ' + pretty(object[property], indent));
                }
            }

            return value.join(newLineJoin) + newLine;
        };

        prettyObjectPrint = function (object, indent) {
            var value = [],
                property;

            indent += indentString;
            for (property in object) {
                if (object.hasOwnProperty(property)) {
                    value.push(indent + property + ': ' + pretty(object[property], indent));
                }
            }

            return value.join(newLineJoin) + newLine;
        };

        prettyArray = function (array, indent) {
            var index,
                length = array.length,
                value = [];

            indent += indentString;
            for (index = 0; index < length; index += 1) {
                value.push(pretty(array[index], indent, indent));
            }

            return value.join(newLineJoin) + newLine;
        };

        functionSignature = function (element) {
            var signatureExpression,
                signature;

            element = element.toString();
            signatureExpression = new RegExp('function\\s*.*\\s*\\(.*\\)');
            signature = signatureExpression.exec(element);
            signature = signature ? signature[0] : '[object Function]';
            return fullFunction ? element : '"' + signature + '"';
        };

        pretty = function (element, indent, fromArray) {
            var type;

            type = valueType(element);
            fromArray = fromArray || '';
            if (visited.indexOf(element) === -1) {
                switch (type) {
                    case 'array':
                        visited.push(element);
                        return fromArray + '[' + newLine + prettyArray(element, indent) + indent + ']';

                    case 'boolean':
                        return fromArray + (element ? 'true' : 'false');

                    case 'date':
                        return fromArray + '"' + element.toString() + '"';

                    case 'number':
                        return fromArray + element;

                    case 'object':
                        visited.push(element);
                        return fromArray + '{' + newLine + prettyObject(element, indent) + indent + '}';

                    case 'string':
                        return fromArray + JSON.stringify(element);

                    case 'function':
                        return fromArray + functionSignature(element);

                    case 'undefined':
                        return fromArray + '"undefined"';

                    default:
                        if (element.toString) {
                            return fromArray + '"' + element.toString() + '"';
                        }
                        return fromArray + '<<<ERROR>>> Cannot get the string value of the element';
                }
            }
            return fromArray + 'circular reference to ' + element.toString();
        };

        if (jsObject) {
            if (indentLength === undefined) {
                indentLength = 4;
            }

            outputTo = (outputTo || 'print').toLowerCase();
            indentString = repeatString(outputTo === 'html' ? '&nbsp;' : ' ', indentLength);
            prettyObject = outputTo === 'json' ? prettyObjectJSON : prettyObjectPrint;
            newLine = outputTo === 'html' ? '<br/>' : '\n';
            newLineJoin = ',' + newLine;
            visited = [];
            return pretty(jsObject, '') + newLine;
        }

        return 'Error: no Javascript object provided';
    };
    return pretty;
});