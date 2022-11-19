import {
	any,
	AnyBaseNode,
	AnyNode,
	AnyRecordKeyNode,
	array,
	bigint,
	boolean,
	date,
	func,
	intersection,
	literal,
	map,
	number,
	object,
	optional,
	record,
	set,
	string,
	tuple,
	union,
	unknown,
} from '@onetyped/core'
import ts, { ObjectType, TypeChecker } from 'typescript'

const hasFlag = (type: ts.Type, flag: ts.TypeFlags): boolean => {
	return (type.flags & flag) === flag
}

const hasSymbolFlag = (symbol: ts.Symbol, flag: ts.SymbolFlags): boolean => {
	return (symbol.flags & flag) === flag
}

const hasObjectFlag = (type: ts.ObjectType, flag: ts.ObjectFlags): boolean => {
	return (type.objectFlags & flag) === flag
}

const getNodeFromCallSignatures = (
	callSignatures: readonly ts.Signature[],
	locationNode: ts.Node,
	checker: TypeChecker,
) => {
	if (callSignatures.length > 0) {
		const nodeCallSignatures = callSignatures.map((signature) => {
			const parameters = signature.getParameters().map((parameter) => {
				const parameterType = checker.getTypeOfSymbolAtLocation(parameter, locationNode)
				return fromType(parameterType, locationNode, checker)
			})
			const returnType = checker.getReturnTypeOfSignature(signature)

			return func({
				arguments: parameters,
				return: fromType(returnType, locationNode, checker),
			})
		}) as [AnyNode, ...AnyNode[]]

		if (nodeCallSignatures.length === 1) {
			return nodeCallSignatures[0]
		}

		return union(nodeCallSignatures)
	}
}

export const fromType = (type: ts.Type, locationNode: ts.Node, checker: ts.TypeChecker): AnyBaseNode => {
	if (hasFlag(type, ts.TypeFlags.String)) {
		return string()
	}

	if (hasFlag(type, ts.TypeFlags.Number)) {
		return number()
	}

	if (hasFlag(type, ts.TypeFlags.Boolean)) {
		return boolean()
	}

	if (hasFlag(type, ts.TypeFlags.Unknown)) {
		return unknown()
	}

	if (type.isLiteral()) {
		if (typeof type.value === 'object') {
			const bigIntLiteral = BigInt(`${type.value.negative ? '-' : ''}${type.value.base10Value}`)
			return literal(bigIntLiteral)
		}

		return literal(type.value)
	}

	if (hasFlag(type, ts.TypeFlags.Any)) {
		return any()
	}

	if (hasFlag(type, ts.TypeFlags.BigInt)) {
		return bigint()
	}

	if (hasFlag(type, ts.TypeFlags.Object)) {
		const objectType = type as ObjectType

		if (hasObjectFlag(objectType, ts.ObjectFlags.Reference)) {
			const { target } = (type as ts.TypeReference)

			if (hasObjectFlag(target, ts.ObjectFlags.Tuple)) {
				const tupleTypes = type.getProperties().map((property) => {
					if (property.name === 'length') return

					const propertyType = checker.getTypeOfSymbolAtLocation(property, locationNode)
					let node = fromType(propertyType, locationNode, checker)
					if (hasSymbolFlag(property, ts.SymbolFlags.Optional)) {
						node = optional(node)
					}

					return node
				}).filter(Boolean) as [AnyNode, ...AnyNode[]]
				return tuple(tupleTypes)
			}
		}

		const propertyEntries = type.getProperties().map((
			property,
		) => {
			const propertyType = checker.getTypeOfSymbolAtLocation(property, locationNode)
			let node = fromType(propertyType, locationNode, checker)
			if (hasSymbolFlag(property, ts.SymbolFlags.Optional)) {
				node = optional(node)
			}
			return [property.name, node]
		})

		const callSignatures = type.getCallSignatures()

		const functionNode = getNodeFromCallSignatures(callSignatures, locationNode, checker)

		if (functionNode) {
			if (propertyEntries.length === 0) {
				return functionNode
			}

			const propertySchemas = Object.fromEntries(propertyEntries)
			return intersection([functionNode, object(propertySchemas)])
		}

		const propertySchemas = Object.fromEntries(propertyEntries)
		const objectNode = object(propertySchemas)

		return objectNode
	}

	const symbol = type.getSymbol()
	if (symbol) {
		switch (symbol.name) {
			case 'Array':
			case 'ReadonlyArray': {
				const typeArguments = checker.getTypeArguments(type as ts.TypeReference)
				return array(fromType(typeArguments[0], locationNode, checker))
			}

			case 'Date': {
				return date()
			}

			case 'Set': {
				const typeArguments = checker.getTypeArguments(type as ts.TypeReference)
				return set(fromType(typeArguments[0], locationNode, checker))
			}

			case 'Record': {
				const typeArguments = checker.getTypeArguments(type as ts.TypeReference)
				return record(
					fromType(typeArguments[0], locationNode, checker) as AnyRecordKeyNode,
					fromType(typeArguments[1], locationNode, checker),
				)
			}

			case 'Map': {
				const typeArguments = checker.getTypeArguments(type as ts.TypeReference)
				return map(
					fromType(typeArguments[0], locationNode, checker),
					fromType(typeArguments[1], locationNode, checker),
				)
			}
		}

		throw new Error(`Unknown symbol name: ${symbol.name}`)
	}

	if (type.isUnion()) {
		const unionTypes = type.types.map((unionType) => fromType(unionType, locationNode, checker)) as [
			AnyNode,
			...AnyNode[],
		]
		return union(unionTypes)
	}

	if (type.isIntersection()) {
		const intersectionTypes = type.types.map((type) => fromType(type, locationNode, checker)) as [
			AnyNode,
			...AnyNode[],
		]
		return intersection(intersectionTypes)
	}

	throw new Error(`Unknown type: ${checker.typeToString(type)}`)
}
